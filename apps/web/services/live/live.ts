import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  errorHandling,
} from '@services/utils/ts/requests'

export interface LiveTokenResponse {
  // Short-lived LiveKit JOIN token. This is the ONLY LiveKit credential the
  // browser ever receives — the api-secret stays in the FastAPI backend.
  token: string
  // Public wss:// signalling URL (no secret), returned by the backend from its
  // LIVEKIT_URL env so the client needs no NEXT_PUBLIC_* var of its own.
  url: string
  room: string
  identity: string
  role: string
}

/**
 * Ask the LearnHouse backend to mint a LiveKit join token for the live room of
 * a course (optionally scoped to a single lesson/activity). The backend
 * authorizes the user against the course before signing.
 */
export async function getLiveToken(
  courseUuid: string,
  activityUuid: string | null,
  access_token: string
): Promise<LiveTokenResponse> {
  const result = await fetch(
    `${getAPIUrl()}live/token`,
    RequestBodyWithAuthHeader(
      'POST',
      { course_uuid: courseUuid, activity_uuid: activityUuid },
      null,
      access_token
    )
  )
  return errorHandling(result)
}
