"""
Sign in with the Kuploy instance that runs this Academy (kuploy-cloud#1443).

A trainee signs in once on the operator's own domain — gokagny.com — and
arrives here already authenticated. This module accepts that sign-in.

## This is a fork change, and it is shaped to survive an upstream merge

Everything that can live in a new file lives here, because upstream never
touches a file it does not have. `utils.py`'s `signWithGoogle` is NOT
refactored to share code with this, even though the two overlap: a shared
helper carved out of it would conflict on every upstream edit to Google
sign-in, which is the file's busiest function. Three small touch points
remain in upstream files, each one a few lines in an obvious place:

  * `ThirdPartyLogin` gains "kuploy" in its provider Literal and an optional
    `id_token`;
  * `/oauth` gains an `elif body.provider == "kuploy"` branch;
  * the org-invite gate gains the matching branch, so the invite is checked
    against the email the TOKEN carries rather than the one the body claims.

## What is verified, and the one claim better-auth does not send

The instance hands the Academy an OIDC id_token. better-auth signs it with
HS256 over the client secret the two sides share — not RS256 and no JWKS — so
verification needs no network call, only `LEARNHOUSE_KUPLOY_CLIENT_SECRET`.

`aud` must equal our client id. That is the confused-deputy check: without it
an id_token minted for a different client of the same instance could be
replayed here.

There is NO `iss` claim. better-auth's oidc-provider omits it unless the JWT
plugin is enabled, and the instance does not enable it, so `verify_iss` is
off. Requiring `iss` would refuse every real token. If a future better-auth
starts emitting one, turning the check on is a one-line change and the
constant below is where the expected value would go.

`email_verified` must be true. The instance only issues it for an address it
verified itself, and accepting an unverified one would let somebody who
signed up on the instance with a victim's address take over that victim's
Academy account. The string "true" is accepted as well as the boolean,
because that is the trap `signWithGoogle` documents having been caught by.
"""

import logging
import os
import random
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import HTTPException, Request
from jwt.exceptions import PyJWTError
from sqlmodel import func, select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User, UserCreate, UserRead
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
)
from src.services.security.account_lockout import update_login_info
from src.services.security.rate_limiting import get_client_ip
from src.services.users.users import create_user, create_user_without_org

logger = logging.getLogger(__name__)

CLIENT_ID_ENV = "LEARNHOUSE_KUPLOY_CLIENT_ID"
CLIENT_SECRET_ENV = "LEARNHOUSE_KUPLOY_CLIENT_SECRET"
#: The instance's own origin, e.g. "https://gokagny.com". Used to build the
#: authorize and token URLs, and it is what an `iss` check would compare
#: against if better-auth ever starts sending one.
ISSUER_ENV = "LEARNHOUSE_KUPLOY_ISSUER"

#: What `signup_method` records for an account that first arrived this way.
SIGNUP_PROVIDER = "kuploy"

_ALGORITHM = "HS256"


def kuploy_sso_configured() -> bool:
    """True when this Academy has an instance to sign people in from."""
    return bool(os.environ.get(CLIENT_ID_ENV) and os.environ.get(CLIENT_SECRET_ENV))


def decode_kuploy_id_token(id_token: str) -> dict:
    """
    Verify the instance's id_token and return its claims.

    Raises 401 on anything that is not a token this Academy can trust: a bad
    signature, an expired token, a different audience, or an address the
    instance did not verify.
    """
    client_id = os.environ.get(CLIENT_ID_ENV)
    client_secret = os.environ.get(CLIENT_SECRET_ENV)
    if not client_id or not client_secret:
        # A misconfigured Academy refuses rather than letting a token through
        # unverified. Configuration is the operator's, so it is a 503.
        logger.error(
            "Kuploy SSO was attempted but %s / %s are not set", CLIENT_ID_ENV, CLIENT_SECRET_ENV
        )
        raise HTTPException(
            status_code=503,
            detail="Sign-in with this site's account is not configured",
        )

    try:
        claims = jwt.decode(
            id_token,
            client_secret,
            algorithms=[_ALGORITHM],
            audience=client_id,
            # No `iss` to check — see the module docstring.
            options={"verify_iss": False, "require": ["aud", "exp", "sub"]},
        )
    except PyJWTError as error:
        # Do not echo the token or the decoder's message: it distinguishes a
        # wrong signature from a wrong audience, which is a probing oracle.
        logger.warning("Kuploy id_token rejected: %s", type(error).__name__)
        raise HTTPException(status_code=401, detail="Sign-in could not be verified")

    email = claims.get("email")
    verified = claims.get("email_verified")
    if isinstance(verified, str):
        email_is_verified = verified.strip().lower() == "true"
    else:
        email_is_verified = verified is True

    if not email or not email_is_verified:
        raise HTTPException(
            status_code=401,
            detail="This site did not return a verified email for the account",
        )

    return claims


def kuploy_verified_email(id_token: str) -> str:
    """
    The one address this sign-in is allowed to own, lower-cased.

    The org-invite gate in `/oauth` calls this so that the invite is checked
    against the email the token carries. Checking `body.email` there would let
    somebody present their own token while naming a victim's invited address,
    and get their own account into an org nobody invited them to.
    """
    return str(decode_kuploy_id_token(id_token)["email"]).strip().lower()


async def signWithKuploy(
    request: Request,
    id_token: str,
    org_id: Optional[int] = None,
    current_user=None,
    db_session: AsyncSession = None,  # type: ignore[assignment]
):
    """
    Sign in, or sign up, the person this id_token belongs to.

    Mirrors `signWithGoogle` deliberately, including matching an existing
    account case-insensitively: local sign-ups store the address exactly as
    typed, so an exact compare against a lower-cased one would create a
    silent duplicate account.
    """
    claims = decode_kuploy_id_token(id_token)
    user_email = str(claims["email"]).strip().lower()

    user = (
        await db_session.execute(select(User).where(func.lower(User.email) == user_email))
    ).scalars().first()

    if not user:
        given_name = claims.get("given_name") or ""
        family_name = claims.get("family_name") or ""
        picture = claims.get("picture") or ""

        # better-auth stores one `name`, so split it only when the instance
        # did not send the parts.
        if not given_name and not family_name and claims.get("name"):
            parts = str(claims["name"]).split(None, 1)
            given_name = parts[0]
            family_name = parts[1] if len(parts) > 1 else ""

        username_parts = [part for part in (given_name, family_name) if part]
        if not username_parts and "@" in user_email:
            prefix = user_email.split("@")[0]
            if prefix:
                username_parts.append(prefix)
        if not username_parts:
            username_parts.append("user")

        # A wide random suffix, for the reason signWithGoogle records: a
        # narrow one collides on common names, and the collision surfaces as
        # "already in use" on the generated username, locking out an account
        # that is otherwise new.
        username = "".join(username_parts) + str(random.randint(100000, 999999))

        user_object = UserCreate(
            email=user_email,
            username=username,
            password="",
            first_name=given_name,
            last_name=family_name,
            avatar_image=picture,
        )

        if org_id is not None:
            return await create_user(
                request,
                db_session,
                current_user,
                user_object,
                org_id,
                is_oauth=True,
                signup_provider=SIGNUP_PROVIDER,
            )
        return await create_user_without_org(
            request,
            db_session,
            current_user,
            user_object,
            is_oauth=True,
            signup_provider=SIGNUP_PROVIDER,
        )

    needs_update = False
    if not user.email_verified:
        # The instance verified it, which is the whole premise of this flow.
        user.email_verified = True
        user.email_verified_at = datetime.now(timezone.utc).isoformat()
        needs_update = True
    if not user.signup_method:
        user.signup_method = SIGNUP_PROVIDER
        needs_update = True
    if needs_update:
        db_session.add(user)
        await db_session.commit()
        await db_session.refresh(user)

    # An existing account accepting an org invite must still join the org.
    # The router validated `org_id` against a pending invite for the address
    # the token carries before we got here.
    if org_id is not None and user.id is not None:
        from src.db.user_organizations import UserOrganization
        from src.security.features_utils.usage import (
            check_limits_with_usage,
            increase_feature_usage,
        )

        existing_membership = (
            await db_session.execute(
                select(UserOrganization).where(
                    (UserOrganization.user_id == user.id)
                    & (UserOrganization.org_id == org_id)
                )
            )
        ).scalars().first()

        if not existing_membership:
            await check_limits_with_usage("members", org_id, db_session)
            user_organization = UserOrganization(
                user_id=user.id,
                org_id=org_id,
                role_id=4,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(user_organization)
            await db_session.commit()
            await db_session.refresh(user_organization)
            await increase_feature_usage("members", org_id, db_session)

    client_ip = get_client_ip(request)
    await update_login_info(user, client_ip, db_session)

    return UserRead.model_validate(user)


async def join_open_org(
    user_id: int, requested_org_id: int | None, db_session: AsyncSession
) -> None:
    """
    Make the person who just signed in a member, if the org is open to anyone.

    Without this they land as a guest and are asked to join a second time.
    A single-tenancy instance has one org, so it is chosen here: the org id
    the browser sends depends on a cookie that can fail to arrive. Invite-only
    orgs are left alone. This never raises, because the sign-in has already
    succeeded and a failed join only leaves the "join" button in place.
    """
    try:
        org_id = requested_org_id
        if get_learnhouse_config().hosting_config.tenancy == "single":
            # Same choice as /instance/info: slug "default", else the oldest.
            default_org = (
                await db_session.execute(
                    select(Organization).where(Organization.slug == "default")
                )
            ).scalars().first() or (
                await db_session.execute(
                    select(Organization).order_by(Organization.id).limit(1)
                )
            ).scalars().first()
            org_id = default_org.id if default_org else None
        if org_id is None:
            return

        org_config = (
            await db_session.execute(
                select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
            )
        ).scalars().first()
        if org_config is None:
            return
        # Read as get_org_join_mechanism does; that one needs an RBAC context.
        config = org_config.config or {}
        section = (
            "admin_toggles"
            if config.get("config_version", "1.0").startswith("2")
            else "features"
        )
        if config.get(section, {}).get("members", {}).get("signup_mode", "open") != "open":
            return

        membership = (
            await db_session.execute(
                select(UserOrganization).where(
                    (UserOrganization.user_id == user_id)
                    & (UserOrganization.org_id == org_id)
                )
            )
        ).scalars().first()
        if membership:
            return

        await check_limits_with_usage("members", org_id, db_session)
        db_session.add(
            UserOrganization(
                user_id=user_id,
                org_id=org_id,
                role_id=4,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db_session.commit()
        await increase_feature_usage("members", org_id, db_session)

        from src.routers.users import _invalidate_session_cache

        _invalidate_session_cache(user_id)
    except Exception:
        logger.warning("Could not add user %s to the organization", user_id, exc_info=True)
        await db_session.rollback()
