"""LiveKit join-token signing for LearnHouse live classrooms.

SECURITY MODEL — read before touching this file.

LearnHouse holds exactly ONE LiveKit secret: ``LIVEKIT_KEYS`` (``apikey:apisecret``),
injected server-side into the backend env by the kuploy stack-connection primitive
(``env:LIVEKIT_KEYS``). It is used here, and ONLY here, to sign short-lived room
JOIN tokens.

- The api-**secret** never leaves this backend. It is NEVER exposed as a
  ``NEXT_PUBLIC_*`` var and NEVER shipped to the browser. The browser receives
  only the minted JOIN token (a JWT it cannot forge). Leak the api-secret and
  anyone can mint a token for any room as any identity.
- LearnHouse has NO knowledge of — and never references — the STUNner shared
  secret or the minted per-tenant TURN credential. The browser needs no TURN
  credential: the SFU advertises relay candidates itself. Those secrets live
  entirely in kuploy-server / the LiveKit pod, not here.

A LiveKit access token is a plain HS256 JWT (``iss`` = api key, ``sub`` =
identity, plus a ``video`` grant), so we sign it with the already-present
``pyjwt`` rather than pulling in the ``livekit-api`` SDK.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Optional

import jwt

# 6h: long enough to outlive a class session, short enough that a leaked token
# is not indefinitely valid. The token is re-minted every time a user opens the
# room, so there is no benefit to a longer life.
DEFAULT_TOKEN_TTL_SECONDS = 6 * 60 * 60


class LiveKitConfigError(RuntimeError):
    """Raised when LiveKit credentials/URL are missing or malformed.

    Callers map this to HTTP 503 — live classrooms are an optional feature that
    is only wired up when a LiveKit component is connected to the stack.
    """


@dataclass(frozen=True)
class LiveKitCredentials:
    api_key: str
    api_secret: str


def get_livekit_credentials() -> LiveKitCredentials:
    """Parse ``LIVEKIT_KEYS`` (``apikey:apisecret``) from the backend env.

    The value is split on the FIRST ``:`` only. The api-secret is base64
    (alphabet ``A-Za-z0-9+/=``), so it never contains a colon — splitting on
    the first colon is unambiguous. Surrounding whitespace is tolerated because
    LiveKit's own keys format is ``key: secret``.
    """
    raw = (os.getenv("LIVEKIT_KEYS") or "").strip()
    if not raw:
        raise LiveKitConfigError("LIVEKIT_KEYS is not set")

    api_key, sep, api_secret = raw.partition(":")
    api_key, api_secret = api_key.strip(), api_secret.strip()
    if not sep or not api_key or not api_secret:
        raise LiveKitConfigError("LIVEKIT_KEYS must be in 'apikey:apisecret' form")

    return LiveKitCredentials(api_key=api_key, api_secret=api_secret)


def get_livekit_url() -> str:
    """Return the public ``wss://`` signalling URL for the browser client.

    Injected by the stack connection (``wsUrl`` -> ``LIVEKIT_URL``). This URL is
    browser-facing and carries no secret, so it is safe to hand back to the
    client alongside the token (which is why the client never needs a
    ``NEXT_PUBLIC_LIVEKIT_URL`` var of its own).
    """
    url = (os.getenv("LIVEKIT_URL") or "").strip()
    if not url:
        raise LiveKitConfigError("LIVEKIT_URL is not set")
    return url


def create_join_token(
    credentials: LiveKitCredentials,
    *,
    room: str,
    identity: str,
    name: str,
    can_publish: bool = True,
    metadata: Optional[dict] = None,
    ttl_seconds: int = DEFAULT_TOKEN_TTL_SECONDS,
    now: Optional[int] = None,
) -> str:
    """Mint a signed LiveKit JOIN token (HS256 JWT) for a single participant.

    ``identity`` must be stable & unique per participant (we use the LearnHouse
    ``user_uuid``); LiveKit kicks an existing connection that joins again with
    the same identity. ``can_publish`` gates whether the participant may send
    audio/video — subscription (seeing/hearing others) is always allowed.
    Audio-only is purely a client-side capture choice and does not change the
    grant: it is the same room with the camera left off.
    """
    issued_at = int(time.time()) if now is None else now

    video_grant = {
        "room": room,
        "roomJoin": True,
        "canPublish": can_publish,
        "canSubscribe": True,
        # data channels (for future in-class polls/captions) — harmless to allow.
        "canPublishData": True,
    }

    claims = {
        "iss": credentials.api_key,
        "sub": identity,
        "name": name,
        "nbf": issued_at,
        "exp": issued_at + ttl_seconds,
        "video": video_grant,
    }
    if metadata is not None:
        # LiveKit surfaces this as participant.metadata to every other client.
        claims["metadata"] = json.dumps(metadata, separators=(",", ":"))

    return jwt.encode(claims, credentials.api_secret, algorithm="HS256")
