'use client'

import '@livekit/components-styles'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from '@livekit/components-react'
import { getLiveToken } from '@services/live/live'
import BoardCanvasClient from '@/app/board/[boarduuid]/client'

interface LiveClassroomProps {
  courseUuid: string
  /** Optional lesson scope; when set, the room is keyed on the activity. */
  activityUuid?: string | null
  /** Optional board rendered beside the video grid (board_… uuid). */
  boardUuid?: string | null
  accessToken: string
  orgslug: string
  username: string
  /**
   * Join with the camera off. Audio-only is the SAME room with video
   * publishing disabled — nothing changes server-side.
   */
  audioOnly?: boolean
}

/**
 * Live classroom: a LiveKit video grid rendered beside a LearnHouse Board.
 *
 * SECURITY: the browser only ever holds the short-lived JOIN token and the
 * public wss:// URL — both returned together by the backend. The LiveKit
 * api-secret never reaches the client, and no STUNner/TURN credential is
 * involved here: the SFU advertises its relay candidates itself, so the
 * browser needs no TURN credential to relay media (connectionType:"turn").
 */
export default function LiveClassroom({
  courseUuid,
  activityUuid = null,
  boardUuid = null,
  accessToken,
  orgslug,
  username,
  audioOnly = false,
}: LiveClassroomProps) {
  const {
    data: live,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['live-token', courseUuid, activityUuid],
    queryFn: () => getLiveToken(courseUuid, activityUuid, accessToken),
    enabled: !!accessToken,
    // The token is short-lived; re-mint on remount rather than caching it long.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f8f8]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-black" />
      </div>
    )
  }

  if (error || !live) {
    const message =
      (error as any)?.message ||
      'Could not join the live classroom. It may not be enabled for this instance.'
    return (
      <div className="flex h-screen items-center justify-center bg-[#f8f8f8]">
        <p className="max-w-md px-6 text-center text-gray-500">{message}</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col md:flex-row bg-[#f8f8f8]">
      {/* Video grid. min-w-0/min-h-0 lets this flex child shrink to its 1/2
          basis — without it the wide LiveKit grid keeps min-width:auto and
          squeezes the Board pane to ~0. */}
      <div
        className={
          boardUuid
            ? 'h-1/2 min-h-0 md:h-full md:w-1/2 md:min-w-0'
            : 'h-full w-full'
        }
      >
        <LiveKitRoom
          serverUrl={live.url}
          token={live.token}
          connect={true}
          // Audio-only = same room, camera left off (video publishing disabled).
          video={!audioOnly}
          audio={true}
          data-lk-theme="default"
          className="h-full"
        >
          <VideoConference />
          {/* Plays remote participants' audio. */}
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>

      {/* LearnHouse Board, side by side with the video */}
      {boardUuid && (
        <div className="h-1/2 min-h-0 md:h-full md:w-1/2 md:min-w-0 border-t md:border-t-0 md:border-l border-gray-200">
          <BoardCanvasClient
            boardUuid={boardUuid}
            accessToken={accessToken}
            orgslug={orgslug}
            username={username}
          />
        </div>
      )}
    </div>
  )
}
