"""Live classroom endpoints — mint LiveKit JOIN tokens for authenticated users.

The browser calls ``POST /api/v1/live/token`` with a course (and optionally a
specific lesson/activity); we authorize the caller against the course, then sign
and return a short-lived LiveKit JOIN token plus the public ``wss://`` URL. The
LiveKit api-secret stays here and is never returned — only the minted token is.
See ``src/services/live/livekit.py`` for the full secret model.
"""

from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.security.rbac import check_resource_access, AccessAction
from src.services.live.livekit import (
    LiveKitConfigError,
    create_join_token,
    get_livekit_credentials,
    get_livekit_url,
)

router = APIRouter()


class LiveTokenRequest(BaseModel):
    # The course gates access: the caller must have at least READ on it.
    course_uuid: str
    # Optional lesson/activity scope. When present, the live room is keyed on
    # the activity so each lesson gets its own room; otherwise the whole course
    # shares one room.
    activity_uuid: str | None = None


class LiveTokenResponse(BaseModel):
    token: str
    url: str
    room: str
    identity: str
    role: str


def _display_name(user: PublicUser) -> str:
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or user.username


@router.post(
    "/token",
    response_model=LiveTokenResponse,
    summary="Mint a LiveKit join token for a live classroom",
    description=(
        "Issues a short-lived LiveKit JOIN token for the authenticated user, "
        "scoped to the live room of a course (or a specific lesson). The user "
        "joins as themselves; instructors (course write access) are granted "
        "publish rights, learners join with publish rights for an interactive "
        "classroom. The LiveKit api-secret never leaves the backend."
    ),
    responses={
        200: {"description": "Join token issued.", "model": LiveTokenResponse},
        401: {"description": "Authentication required"},
        403: {"description": "No access to this course"},
        503: {"description": "Live classrooms are not configured for this instance"},
    },
)
async def issue_join_token(
    request: Request,
    body: LiveTokenRequest,
    db_session: AsyncSession = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> LiveTokenResponse:
    # Authorize: the caller must be able to READ the course. Anonymous callers
    # and API tokens are rejected at the router level (see registration in
    # router.py) so we always have a real user identity to join as.
    await check_resource_access(
        request, db_session, current_user, body.course_uuid, AccessAction.READ
    )

    # Course write access => instructor. We surface this as participant metadata
    # for the client (e.g. to badge the teacher); both roles may publish so the
    # classroom is interactive.
    instructor_decision = await check_resource_access(
        request,
        db_session,
        current_user,
        body.course_uuid,
        AccessAction.UPDATE,
        raise_on_deny=False,
    )
    role = "instructor" if instructor_decision.allowed else "learner"

    try:
        credentials = get_livekit_credentials()
        url = get_livekit_url()
    except LiveKitConfigError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Live classrooms are not configured: {exc}",
        )

    room = body.activity_uuid or body.course_uuid
    identity = current_user.user_uuid
    token = create_join_token(
        credentials,
        room=room,
        identity=identity,
        name=_display_name(current_user),
        can_publish=True,
        metadata={"role": role, "username": current_user.username},
    )

    return LiveTokenResponse(
        token=token, url=url, room=room, identity=identity, role=role
    )
