"""Tests for headless assignment access via org-scoped API tokens.

The assignment authoring + grading service functions used to hard-block every
API token (``_block_api_tokens``). They now route instructor-style access
through ``authorize_assignment_access``, which checks the single ``assignments``
rights bucket and enforces the org boundary via the parent course UUID. The
learner ``/me`` / self-submission / retry endpoints stay session-only.

These tests pin that contract end-to-end against the real test DB:
  - a token with the right ``assignments`` action can author / read / grade;
  - a token missing the action gets 403;
  - a token from another org gets 403 (org boundary);
  - session-only endpoints still 403 for any token, even a fully-privileged one.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.assignments import (
    Assignment,
    AssignmentCreate,
    AssignmentRead,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.assignments import AssignmentTaskSubmissionUpdate
from src.db.users import APITokenUser, User
from src.db.trails import Trail
from src.services.courses.activities.assignments import (
    create_assignment,
    create_assignment_submission,
    grade_assignment_submission,
    handle_assignment_task_submission,
    read_assignment,
    read_assignment_submissions,
    retry_assignment_submission,
)
from sqlmodel import select

_PATCH_TRAIL_PRESENCE = "src.services.courses.activities.assignments.check_trail_presence"
_PATCH_CERT_CHECK = (
    "src.services.courses.activities.assignments."
    "check_course_completion_and_create_certificate"
)
_PATCH_TRACK = "src.services.courses.activities.assignments.track"
_PATCH_DISPATCH = "src.services.courses.activities.assignments.dispatch_webhooks"

_PATCH_LIMITS = "src.services.courses.activities.assignments.check_limits_with_usage"
_PATCH_INCREASE = "src.services.courses.activities.assignments.increase_feature_usage"
_PATCH_DISPATCH = "src.services.courses.activities.assignments.dispatch_webhooks"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assignments_rights(create=False, read=False, update=False, delete=False):
    return {
        "action_create": create,
        "action_read": read,
        "action_update": update,
        "action_delete": delete,
    }


def _token(org_id=1, **buckets):
    """Build an APITokenUser whose ``rights`` dict carries the given buckets."""
    return APITokenUser(
        id=1,
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org_id,
        rights=dict(buckets),
        token_name="Test Token",
        created_by_user_id=1,
    )


async def _make_assignment(db, org, course, chapter, activity, *, auto_grading=False):
    a = Assignment(
        title="Headless",
        description="x",
        due_date="2030-01-01",
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=auto_grading,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_token_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


def _assignment_create_obj(org, course, chapter, activity, title="New Assignment"):
    return AssignmentCreate(
        title=title,
        description="Desc",
        due_date="2030-01-01",
        grading_type=GradingTypeEnum.NUMERIC,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
    )


# ---------------------------------------------------------------------------
# Authoring (assignments bucket)
# ---------------------------------------------------------------------------


class TestTokenAuthoring:
    async def test_token_with_create_can_create_assignment(
        self, mock_request, db, org, course, chapter, activity
    ):
        token = _token(assignments=_assignments_rights(create=True))
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            result = await create_assignment(mock_request, obj, token, db)
        assert isinstance(result, AssignmentRead)
        assert result.title == "New Assignment"

    async def test_token_without_create_is_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        token = _token(assignments=_assignments_rights(read=True))  # no create
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, token, db)
        assert exc.value.status_code == 403

    async def test_token_with_no_assignments_bucket_is_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        # Token has other buckets but not `assignments` at all.
        token = _token(courses={"action_create": True})
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, token, db)
        assert exc.value.status_code == 403

    async def test_cross_org_token_is_forbidden(
        self, mock_request, db, org, other_org, course, chapter, activity
    ):
        # Token belongs to org 2; the course lives in org 1 -> org boundary 403.
        token = _token(org_id=other_org.id, assignments=_assignments_rights(create=True))
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, token, db)
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Reading (assignments bucket, read action)
# ---------------------------------------------------------------------------


class TestTokenReading:
    async def test_token_with_read_can_read_assignment(
        self, mock_request, db, org, course, chapter, activity
    ):
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(read=True))
        result = await read_assignment(mock_request, "assignment_token_test", token, db)
        assert isinstance(result, AssignmentRead)

    async def test_token_without_read_is_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))  # no read
        with pytest.raises(HTTPException) as exc:
            await read_assignment(mock_request, "assignment_token_test", token, db)
        assert exc.value.status_code == 403

    async def test_token_with_read_can_list_submissions(
        self, mock_request, db, org, course, chapter, activity
    ):
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(read=True))
        result = await read_assignment_submissions(
            mock_request, "assignment_token_test", token, db
        )
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# Grading (assignments bucket, update action)
# ---------------------------------------------------------------------------


class TestTokenGrading:
    async def _seed_submission(self, db, org, course, chapter, activity, regular_user):
        assignment = await _make_assignment(db, org, course, chapter, activity)
        task = AssignmentTask(
            title="Q1",
            description="What is 2+2?",
            hint="",
            reference_file=None,
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
            contents={"correct_answers": ["4"], "match_mode": "exact"},
            max_grade_value=100,
            assignment_id=assignment.id,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=activity.id,
            assignment_task_uuid="assignmenttask_token_test",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)

        user_submission = AssignmentUserSubmission(
            user_id=regular_user.id,
            assignment_id=assignment.id,
            grade=0,
            submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
            attempt_number=1,
            assignmentusersubmission_uuid="aus_token_test",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user_submission)
        task_submission = AssignmentTaskSubmission(
            assignment_task_submission_uuid="ats_token_test",
            task_submission={"answer": "4"},  # correct
            grade=0,
            manually_graded=False,
            task_submission_grade_feedback="",
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
            user_id=regular_user.id,
            activity_id=task.activity_id,
            course_id=task.course_id,
            chapter_id=task.chapter_id,
            assignment_task_id=task.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(task_submission)
        await db.commit()
        return assignment

    async def test_token_with_update_can_finalize_grade(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_submission(db, org, course, chapter, activity, regular_user)
        token = _token(assignments=_assignments_rights(update=True))
        with patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await grade_assignment_submission(
                mock_request, regular_user.id, "assignment_token_test", token, db,
                overall_feedback="Nice work",
            )
        # Correct short answer -> full marks, submission marked GRADED.
        assert result["grade"] == 100

    async def test_token_without_update_cannot_grade(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_submission(db, org, course, chapter, activity, regular_user)
        token = _token(assignments=_assignments_rights(read=True))  # no update
        with pytest.raises(HTTPException) as exc:
            await grade_assignment_submission(
                mock_request, regular_user.id, "assignment_token_test", token, db,
            )
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Session-only endpoints stay blocked for tokens
# ---------------------------------------------------------------------------


class TestTokenSubmitOnBehalf:
    """A token with assignments.create may write a learner's answer by user_id."""

    async def _seed_task(self, db, org, course, chapter, activity):
        assignment = await _make_assignment(db, org, course, chapter, activity)
        task = AssignmentTask(
            title="Q1", description="d", hint="", reference_file=None,
            assignment_type=AssignmentTaskTypeEnum.CUSTOM, contents={"widget": "x"},
            max_grade_value=100, assignment_id=assignment.id, org_id=org.id,
            course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
            assignment_task_uuid="assignmenttask_obo_test",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(task)
        await db.commit()
        return assignment, task

    async def test_token_submits_task_answer_for_learner(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "my custom answer"})
        result = await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test", body, token, db,
            on_behalf_of_user_id=regular_user.id,
        )
        # Persisted against the LEARNER, not the token.
        assert result.user_id == regular_user.id
        row = (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == regular_user.id
            )
        )).scalars().first()
        assert row is not None
        assert row.task_submission == {"answer": "my custom answer"}

    async def test_token_submit_requires_on_behalf_id(
        self, mock_request, db, org, course, chapter, activity
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", body, token, db,
            )
        assert exc.value.status_code == 400

    async def test_token_submit_without_create_right_forbidden(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(read=True))  # no create
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", body, token, db,
                on_behalf_of_user_id=regular_user.id,
            )
        assert exc.value.status_code == 403

    async def test_token_submit_for_non_member_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        await self._seed_task(db, org, course, chapter, activity)
        # A user with no membership in the token's org.
        outsider = User(
            id=999, username="outsider", first_name="O", last_name="O",
            email="outsider@x.com", password="x", user_uuid="user_outsider",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(outsider)
        await db.commit()
        token = _token(assignments=_assignments_rights(create=True))
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", body, token, db,
                on_behalf_of_user_id=outsider.id,
            )
        assert exc.value.status_code == 403

    async def test_token_submit_unknown_learner_404(
        self, mock_request, db, org, course, chapter, activity
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", body, token, db,
                on_behalf_of_user_id=999999,
            )
        assert exc.value.status_code == 404

    async def test_token_creates_assignment_submission_for_learner(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await _make_assignment(db, org, course, chapter, activity)
        trail = Trail(
            org_id=org.id, user_id=regular_user.id, trail_uuid="trail_obo_test",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)
        token = _token(assignments=_assignments_rights(create=True))
        with patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock, return_value=trail), \
             patch(_PATCH_CERT_CHECK, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await create_assignment_submission(
                mock_request, "assignment_token_test", token, db,
                on_behalf_of_user_id=regular_user.id,
            )
        # Aggregate submission created for the LEARNER and marked submitted.
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
        assert result.user_id == regular_user.id


class TestSessionOnlyEndpointsStillBlockTokens:
    async def test_retry_blocks_token(
        self, mock_request, db, org, course, chapter, activity
    ):
        # Retry stays session-only — even a full-rights token is rejected.
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(
            assignments=_assignments_rights(create=True, read=True, update=True, delete=True)
        )
        with pytest.raises(HTTPException) as exc:
            await retry_assignment_submission(
                mock_request, "assignment_token_test", token, db
            )
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# A token with assignments.update grades on submit (learnhouse#21)
# ---------------------------------------------------------------------------


class TestTokenGradesOnSubmit:
    """The lab checker submits a learner's answer AND the grade it computed in one
    call. Before #21 every token hit the 403 "You do not have permission to update
    grades" as soon as the body carried a grade, so a passed lab never left
    SUBMITTED. The refusal is what has to stay pinned: a token without
    ``assignments.update`` still gets that 403, and an instructor session is
    unchanged."""

    _seed_task = TestTokenSubmitOnBehalf._seed_task

    def _graded_body(self):
        return AssignmentTaskSubmissionUpdate(
            task_submission={"answer": "deployed, health 200"},
            grade=80,
            task_submission_grade_feedback="Service reachable on its domain",
            manually_graded=True,
        )

    async def _row(self, db, regular_user):
        return (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == regular_user.id
            )
        )).scalars().first()

    async def test_token_with_update_keeps_grade_feedback_and_flag(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True, update=True))
        result = await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test", self._graded_body(), token, db,
            on_behalf_of_user_id=regular_user.id,
        )
        assert result.user_id == regular_user.id
        row = await self._row(db, regular_user)
        assert row.task_submission == {"answer": "deployed, health 200"}
        assert row.grade == 80, "the grade the checker computed was dropped"
        assert row.task_submission_grade_feedback == "Service reachable on its domain"
        assert row.manually_graded is True, "the row would be re-graded by the server pass"

    async def test_token_with_update_regrades_an_existing_answer(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        # First the answer alone, then the graded call: the same row, now graded.
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True, update=True))
        await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test",
            AssignmentTaskSubmissionUpdate(task_submission={"answer": "first try"}), token, db,
            on_behalf_of_user_id=regular_user.id,
        )
        assert (await self._row(db, regular_user)).grade == 0
        await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test", self._graded_body(), token, db,
            on_behalf_of_user_id=regular_user.id,
        )
        rows = (await db.execute(
            select(AssignmentTaskSubmission).where(AssignmentTaskSubmission.user_id == regular_user.id)
        )).scalars().all()
        assert len(rows) == 1, "a second row instead of an update"
        assert rows[0].grade == 80
        assert rows[0].manually_graded is True

    async def test_token_without_update_still_cannot_grade(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        # THE PIN. create alone is what every submit-on-behalf token had before
        # #21; a grade in its body must still be refused, not silently dropped.
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", self._graded_body(), token, db,
                on_behalf_of_user_id=regular_user.id,
            )
        assert exc.value.status_code == 403
        assert exc.value.detail == "You do not have permission to update grades"
        assert await self._row(db, regular_user) is None, "a refused submit wrote a row"

    async def test_token_without_update_answer_only_is_never_graded(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        # Same token, answer only: accepted, and the flag a body cannot carry is
        # forced off (a new answer re-enters the server-graded pool).
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))
        await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test",
            AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"}, manually_graded=True), token, db,
            on_behalf_of_user_id=regular_user.id,
        )
        row = await self._row(db, regular_user)
        assert row.grade == 0
        assert row.manually_graded is False

    async def test_update_token_cannot_repoint_or_rename_the_row(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        # Review 5995080215: the body carries assignment_task_id, assignment_type and
        # assignment_task_submission_uuid, and a grading token used to write all
        # three. The row stays on the task in the URL and keeps its own uuid.
        assignment, task1 = await self._seed_task(db, org, course, chapter, activity)
        task2 = AssignmentTask(
            title="Q2", description="d", hint="", reference_file=None,
            assignment_type=AssignmentTaskTypeEnum.QUIZ, contents={},
            max_grade_value=100, assignment_id=assignment.id, org_id=org.id,
            course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
            assignment_task_uuid="assignmenttask_obo_other",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(task2)
        await db.commit()
        token = _token(assignments=_assignments_rights(create=True, update=True))
        first = await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test",
            AssignmentTaskSubmissionUpdate(task_submission={"answer": "a"}, assignment_task_submission_uuid="assignmenttasksubmission_attacker"),
            token, db, on_behalf_of_user_id=regular_user.id,
        )
        assert first.assignment_task_submission_uuid != "assignmenttasksubmission_attacker"
        body = self._graded_body()
        body.assignment_task_id = task2.id
        body.assignment_type = AssignmentTaskTypeEnum.QUIZ
        body.assignment_task_submission_uuid = "assignmenttasksubmission_attacker"
        await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test", body, token, db,
            on_behalf_of_user_id=regular_user.id,
        )
        rows = (await db.execute(
            select(AssignmentTaskSubmission).where(AssignmentTaskSubmission.user_id == regular_user.id)
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].assignment_task_id == task1.id, "the row moved to another task"
        assert rows[0].assignment_type == AssignmentTaskTypeEnum.CUSTOM
        assert rows[0].assignment_task_submission_uuid == first.assignment_task_submission_uuid, "the row was renamed"
        assert rows[0].grade == 80

    async def test_cross_org_update_token_is_forbidden(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        # update on ANOTHER org buys no grading here: the org boundary is the
        # course's, enforced inside authorize_assignment_access.
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(org_id=org.id + 1, assignments=_assignments_rights(create=True, update=True))
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", self._graded_body(), token, db,
                on_behalf_of_user_id=regular_user.id,
            )
        assert exc.value.status_code == 403

    async def test_instructor_session_unchanged(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        await self._seed_task(db, org, course, chapter, activity)
        result = await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test", self._graded_body(), admin_user, db,
        )
        assert result.grade == 80
        assert result.manually_graded is True
