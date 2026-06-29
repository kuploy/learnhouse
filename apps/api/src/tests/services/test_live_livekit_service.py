"""Tests for src/services/live/livekit.py (LiveKit join-token signing)."""

import json

import jwt
import pytest

from src.services.live.livekit import (
    LiveKitConfigError,
    LiveKitCredentials,
    create_join_token,
    ensure_uuid_prefix,
    get_livekit_credentials,
    get_livekit_url,
)


class TestEnsureUuidPrefix:
    def test_adds_missing_prefix(self):
        # The frontend sends the bare uuid (URLs strip the prefix); RBAC needs it back.
        assert ensure_uuid_prefix("ab12", "course_") == "course_ab12"
        assert ensure_uuid_prefix("xy34", "activity_") == "activity_xy34"

    def test_keeps_existing_prefix(self):
        assert ensure_uuid_prefix("course_ab12", "course_") == "course_ab12"

    def test_passes_through_empty(self):
        assert ensure_uuid_prefix(None, "course_") is None
        assert ensure_uuid_prefix("", "activity_") == ""


class TestGetLiveKitCredentials:
    def test_parses_apikey_apisecret(self, monkeypatch):
        monkeypatch.setenv("LIVEKIT_KEYS", "APIabc:s3cr3t==")
        creds = get_livekit_credentials()
        assert creds.api_key == "APIabc"
        assert creds.api_secret == "s3cr3t=="

    def test_tolerates_surrounding_whitespace(self, monkeypatch):
        # LiveKit's own keys format is "key: secret".
        monkeypatch.setenv("LIVEKIT_KEYS", "  APIabc:  s3cr3t==  ")
        creds = get_livekit_credentials()
        assert creds.api_key == "APIabc"
        assert creds.api_secret == "s3cr3t=="

    def test_missing_raises(self, monkeypatch):
        monkeypatch.delenv("LIVEKIT_KEYS", raising=False)
        with pytest.raises(LiveKitConfigError):
            get_livekit_credentials()

    def test_malformed_raises(self, monkeypatch):
        monkeypatch.setenv("LIVEKIT_KEYS", "no-colon-here")
        with pytest.raises(LiveKitConfigError):
            get_livekit_credentials()


class TestGetLiveKitUrl:
    def test_returns_url(self, monkeypatch):
        monkeypatch.setenv("LIVEKIT_URL", "wss://live.example.com")
        assert get_livekit_url() == "wss://live.example.com"

    def test_missing_raises(self, monkeypatch):
        monkeypatch.delenv("LIVEKIT_URL", raising=False)
        with pytest.raises(LiveKitConfigError):
            get_livekit_url()


class TestCreateJoinToken:
    creds = LiveKitCredentials(api_key="APIabc", api_secret="topsecret")

    def _decode(self, token):
        # Tests pin now=1000 so exp is in the past; we verify the signature and
        # claim contents, not wall-clock expiry.
        return jwt.decode(
            token, "topsecret", algorithms=["HS256"], options={"verify_exp": False}
        )

    def test_token_is_verifiable_and_carries_grant(self):
        token = create_join_token(
            self.creds,
            room="course_123",
            identity="user_xyz",
            name="Ada Lovelace",
            now=1000,
        )
        claims = self._decode(token)
        assert claims["iss"] == "APIabc"
        assert claims["sub"] == "user_xyz"
        assert claims["name"] == "Ada Lovelace"
        assert claims["nbf"] == 1000
        assert claims["exp"] == 1000 + 6 * 60 * 60
        grant = claims["video"]
        assert grant["room"] == "course_123"
        assert grant["roomJoin"] is True
        assert grant["canSubscribe"] is True

    def test_signed_with_api_secret_not_forgeable(self):
        token = create_join_token(
            self.creds, room="r", identity="i", name="n", now=1000
        )
        # A wrong secret must fail verification — proves the api-secret is what
        # gates token minting.
        with pytest.raises(jwt.InvalidSignatureError):
            jwt.decode(token, "wrong-secret", algorithms=["HS256"])

    def test_can_publish_false_disables_publishing_only(self):
        token = create_join_token(
            self.creds,
            room="r",
            identity="i",
            name="n",
            can_publish=False,
            now=1000,
        )
        grant = self._decode(token)["video"]
        assert grant["canPublish"] is False
        assert grant["canSubscribe"] is True  # can still watch/listen

    def test_metadata_is_json_encoded(self):
        token = create_join_token(
            self.creds,
            room="r",
            identity="i",
            name="n",
            metadata={"role": "instructor"},
            now=1000,
        )
        claims = self._decode(token)
        assert json.loads(claims["metadata"]) == {"role": "instructor"}
