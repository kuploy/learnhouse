"""
FORK (kuploy-cloud#1443): sign-in with the Kuploy instance that runs this
Academy.

Five ways this could go wrong, each with a test below:

1. A token this Academy cannot verify is accepted, and anyone who can mint a
   JWT becomes anyone they like.
2. A token minted for a *different* OAuth client of the same instance is
   replayed here — the confused-deputy attack, the same one
   ``test_remediation_google_oauth_aud.py`` covers for Google.
3. An unverified address is accepted, so somebody who signed up on the
   instance with a victim's address takes over that victim's Academy account.
4. A misconfigured Academy (no client id or secret) skips verification instead
   of refusing.
5. The org-invite gate trusts the address in the request body rather than the
   one the token carries, and an attacker lands in an org nobody invited them
   to. ``kuploy_verified_email`` is the gate's only input; the last test pins
   that it comes from the token and nowhere else.

What these cannot see: whether the router actually calls any of this. That is
a route wiring question, and the branch that calls it is pinned by reading
``routers/auth.py`` in review, not here.
"""

import time

import jwt
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.routers.auth import ThirdPartyLogin
from src.services.auth.kuploy import (
    CLIENT_ID_ENV,
    CLIENT_SECRET_ENV,
    decode_kuploy_id_token,
    kuploy_sso_configured,
    kuploy_verified_email,
)

OUR_CLIENT_ID = "academy-sso"
OUR_SECRET = "the-secret-the-two-sides-share"


def _id_token(secret=OUR_SECRET, **overrides):
    now = int(time.time())
    claims = {
        "sub": "user-1",
        "aud": OUR_CLIENT_ID,
        "exp": now + 300,
        "iat": now,
        "email": "awa.diallo@gokagny.com",
        "email_verified": True,
        "name": "Awa Diallo",
    }
    claims.update(overrides)
    return jwt.encode(claims, secret, algorithm="HS256")


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv(CLIENT_ID_ENV, OUR_CLIENT_ID)
    monkeypatch.setenv(CLIENT_SECRET_ENV, OUR_SECRET)


def test_a_token_the_instance_signed_is_accepted(configured):
    claims = decode_kuploy_id_token(_id_token())
    assert claims["email"] == "awa.diallo@gokagny.com"
    assert claims["sub"] == "user-1"


def test_a_token_signed_with_another_secret_is_refused(configured):
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token(secret="not-our-secret"))
    assert exc.value.status_code == 401


def test_a_token_minted_for_another_client_is_refused(configured):
    """The confused deputy: valid signature, wrong audience."""
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token(aud="some-other-client"))
    assert exc.value.status_code == 401


def test_an_expired_token_is_refused(configured):
    now = int(time.time())
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token(exp=now - 1, iat=now - 600))
    assert exc.value.status_code == 401


def test_a_token_with_no_expiry_is_refused(configured):
    """``exp`` is required: a token that never expires is a permanent key."""
    token = _id_token()
    claims = jwt.decode(
        token, OUR_SECRET, algorithms=["HS256"], audience=OUR_CLIENT_ID
    )
    del claims["exp"]
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(jwt.encode(claims, OUR_SECRET, algorithm="HS256"))
    assert exc.value.status_code == 401


def test_an_unverified_address_is_refused(configured):
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token(email_verified=False))
    assert exc.value.status_code == 401


def test_a_missing_address_is_refused(configured):
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token(email=None))
    assert exc.value.status_code == 401


def test_the_string_true_counts_as_verified(configured):
    """The trap signWithGoogle documents having been caught by."""
    claims = decode_kuploy_id_token(_id_token(email_verified="true"))
    assert claims["email"] == "awa.diallo@gokagny.com"


def test_the_string_false_does_not_count_as_verified(configured):
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token(email_verified="false"))
    assert exc.value.status_code == 401


def test_a_misconfigured_academy_refuses_rather_than_skipping(monkeypatch):
    monkeypatch.delenv(CLIENT_ID_ENV, raising=False)
    monkeypatch.delenv(CLIENT_SECRET_ENV, raising=False)
    assert kuploy_sso_configured() is False
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token())
    assert exc.value.status_code == 503


def test_the_secret_alone_is_not_configuration(monkeypatch):
    """Half-configured is still refused, not half-verified."""
    monkeypatch.setenv(CLIENT_SECRET_ENV, OUR_SECRET)
    monkeypatch.delenv(CLIENT_ID_ENV, raising=False)
    assert kuploy_sso_configured() is False
    with pytest.raises(HTTPException) as exc:
        decode_kuploy_id_token(_id_token())
    assert exc.value.status_code == 503


def test_the_invite_gate_reads_the_token_not_the_body(configured):
    """
    The gate's input is the token's own address, lower-cased and trimmed.
    An attacker holding their own instance token cannot make this return a
    victim's address, whatever they put in the request body — the body is not
    an argument to it.
    """
    attacker = _id_token(email="  Attacker@Gokagny.COM ")
    assert kuploy_verified_email(attacker) == "attacker@gokagny.com"


def test_an_unverifiable_token_yields_no_address_for_the_gate(configured):
    with pytest.raises(HTTPException) as exc:
        kuploy_verified_email(_id_token(secret="not-our-secret"))
    assert exc.value.status_code == 401


def test_a_kuploy_request_needs_no_email_and_a_google_one_does():
    """
    Making ``email`` and ``access_token`` optional must not weaken Google's
    path: ``get_google_user_info(None)`` would call Google with the header
    "Bearer None", and ``signWithGoogle`` takes the email as an argument.
    """
    body = ThirdPartyLogin(provider="kuploy", id_token=_id_token())
    assert body.email is None

    with pytest.raises(ValidationError):
        ThirdPartyLogin(provider="kuploy")

    with pytest.raises(ValidationError):
        ThirdPartyLogin(provider="google", email="a@b.com")

    with pytest.raises(ValidationError):
        ThirdPartyLogin(provider="google", access_token="ya29.x")

    google = ThirdPartyLogin(
        provider="google", email="a@b.com", access_token="ya29.x"
    )
    assert google.id_token is None


def test_an_unknown_provider_is_still_refused():
    with pytest.raises(ValidationError):
        ThirdPartyLogin(provider="github", id_token="x")
