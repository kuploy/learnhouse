"""Tests for the third_party_login OAuth handler in src/routers/auth.py.

Targets the `else: raise HTTPException(...)` branch (line ~497) that rejects any
provider other than the supported ones (currently only "google").
"""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import jwt
import pytest
from fastapi import HTTPException, Response, status
from sqlmodel import select

from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser
from src.routers.auth import third_party_login


@pytest.mark.asyncio
async def test_third_party_login_rejects_unsupported_provider():
    # provider != "google" with org_id=None skips the org-validation block and
    # falls straight through to the unsupported-provider `else: raise`.
    body = SimpleNamespace(
        email="user@example.com",
        provider="facebook",
        access_token="tok",
    )

    with pytest.raises(HTTPException) as exc_info:
        await third_party_login(
            request=SimpleNamespace(),
            response=Response(),
            body=body,
            org_id=None,
            current_user=AnonymousUser(),
            db_session=AsyncMock(),
        )

    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc_info.value.detail == "Unsupported provider"


@pytest.mark.asyncio
async def test_third_party_login_non_google_org_id_uses_body_email(db, org):
    """With a valid org_id but a non-google provider, the invite-email is taken
    from ``body.email`` (the ``else`` branch, line 502), the Redis invite key is
    read, and the Redis connection is closed in the finally block before the
    unsupported-provider guard rejects the request with 400."""
    body = SimpleNamespace(
        email="invitee@example.com",
        provider="facebook",
        access_token="tok",
    )
    close_mock = Mock()
    mock_redis = Mock(get=Mock(return_value=None), close=close_mock)
    mock_config = SimpleNamespace(
        redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379")
    )

    with patch(
        "src.routers.auth.get_learnhouse_config", return_value=mock_config
    ), patch("redis.Redis.from_url", return_value=mock_redis):
        with pytest.raises(HTTPException) as exc_info:
            await third_party_login(
                request=SimpleNamespace(),
                response=Response(),
                body=body,
                org_id=org.id,
                current_user=AnonymousUser(),
                db_session=db,
            )

    # Non-google providers key the invite on the raw body email.
    mock_redis.get.assert_called_once_with(
        f"invited_user:invitee@example.com:org:{org.org_uuid}"
    )
    close_mock.assert_called_once()
    assert exc_info.value.status_code == status.HTTP_400_BAD_REQUEST
    assert exc_info.value.detail == "Unsupported provider"


class TestKuployJoinsOpenOrg:
    """kuploy/learnhouse#36: the operator's own sign-in must not leave a guest."""

    async def _sign_in(self, db, mock_request, monkeypatch, org_id=None):
        monkeypatch.setenv("LEARNHOUSE_KUPLOY_CLIENT_ID", "academy-sso")
        monkeypatch.setenv("LEARNHOUSE_KUPLOY_CLIENT_SECRET", "s" * 32)
        id_token = jwt.encode(
            {
                "sub": "user-1",
                "aud": "academy-sso",
                "exp": int(time.time()) + 300,
                "email": "trainee@test.com",
                "email_verified": True,
            },
            "s" * 32,
            algorithm="HS256",
        )
        body = SimpleNamespace(
            email=None, provider="kuploy", access_token=None, id_token=id_token
        )
        with patch("src.services.users.users.track", new_callable=AsyncMock), patch(
            "src.services.users.users.dispatch_webhooks", new_callable=AsyncMock
        ), patch("src.services.users.users.send_account_creation_email"), patch(
            "src.routers.auth.set_auth_cookies"
        ):
            return await third_party_login(
                request=mock_request,
                response=Response(),
                body=body,
                org_id=org_id,
                current_user=AnonymousUser(),
                db_session=db,
            )

    async def _configure(
        self, db, org, signup_mode, tenancy, monkeypatch, version="2.0"
    ):
        section = "admin_toggles" if version.startswith("2") else "features"
        db.add(
            OrganizationConfig(
                org_id=org.id,
                config={
                    "config_version": version,
                    section: {"members": {"signup_mode": signup_mode}},
                },
                creation_date="now",
                update_date="now",
            )
        )
        await db.commit()
        monkeypatch.setattr(
            "src.services.auth.kuploy.get_learnhouse_config",
            lambda: SimpleNamespace(hosting_config=SimpleNamespace(tenancy=tenancy)),
        )

    async def _memberships(self, db):
        rows = (await db.execute(select(UserOrganization))).scalars().all()
        return [(row.org_id, row.role_id) for row in rows]

    @pytest.mark.asyncio
    async def test_single_tenancy_joins_without_an_org_id(
        self, db, org, mock_request, monkeypatch
    ):
        await self._configure(db, org, "open", "single", monkeypatch)
        with patch("src.services.auth.kuploy.check_limits_with_usage"), patch(
            "src.services.auth.kuploy.increase_feature_usage"
        ):
            await self._sign_in(db, mock_request, monkeypatch)
            assert await self._memberships(db) == [(org.id, 4)]

            # An admin removes them: signing in again must not put them back.
            await db.delete(
                (await db.execute(select(UserOrganization))).scalars().one()
            )
            await db.commit()
            await self._sign_in(db, mock_request, monkeypatch)
        assert await self._memberships(db) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize("version", ["1.0", "2.0"])
    async def test_invite_only_org_is_left_alone(
        self, db, org, mock_request, monkeypatch, version
    ):
        await self._configure(db, org, "inviteOnly", "single", monkeypatch, version)
        await self._sign_in(db, mock_request, monkeypatch)
        assert await self._memberships(db) == []

    @pytest.mark.asyncio
    async def test_multi_tenancy_joins_nobody_without_an_org_id(
        self, db, org, mock_request, monkeypatch
    ):
        await self._configure(db, org, "open", "multi", monkeypatch)
        await self._sign_in(db, mock_request, monkeypatch)
        assert await self._memberships(db) == []

    @pytest.mark.asyncio
    async def test_multi_tenancy_joins_the_org_asked_for(
        self, db, org, mock_request, monkeypatch
    ):
        await self._configure(db, org, "open", "multi", monkeypatch)
        # No pending invite, so the router clears org_id for account creation.
        with patch("src.services.auth.kuploy.check_limits_with_usage"), patch(
            "src.services.auth.kuploy.increase_feature_usage"
        ):
            await self._sign_in(db, mock_request, monkeypatch, org_id=org.id)
        assert await self._memberships(db) == [(org.id, 4)]

    @pytest.mark.asyncio
    async def test_a_full_org_never_blocks_the_sign_in(
        self, db, org, mock_request, monkeypatch
    ):
        await self._configure(db, org, "open", "single", monkeypatch)
        with patch(
            "src.services.auth.kuploy.check_limits_with_usage",
            side_effect=HTTPException(status_code=403, detail="Usage Limit"),
        ):
            result = await self._sign_in(db, mock_request, monkeypatch)
        assert result["tokens"]["access_token"]
        assert await self._memberships(db) == []
