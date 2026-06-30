'use client'

import '@livekit/components-styles'
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from '@livekit/components-react'
import { useMediaQuery } from 'usehooks-ts'
import {
  GripVertical,
  Link2,
  Check,
  Video as VideoIcon,
  LayoutDashboard,
  Columns2,
} from 'lucide-react'
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

// Persist the desktop split ratio (video fraction) across sessions.
const SPLIT_KEY = 'lh-live-split-ratio'
const MIN_RATIO = 0.2
const MAX_RATIO = 0.8

type View = 'split' | 'video' | 'board'

/**
 * Live classroom: a LiveKit video grid rendered beside a LearnHouse Board.
 *
 * Layout: on desktop the video and Board sit side by side with a draggable
 * splitter (ratio persisted) and a Video / Split / Board view toggle; on mobile
 * they become Video / Board tabs. A copy-link button shares the exact room URL
 * (including ?board=) so everyone lands on the same board.
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

  const isDesktop = useMediaQuery('(min-width: 768px)')
  const [view, setView] = React.useState<View>('split')
  const [ratio, setRatio] = React.useState(0.5) // video fraction (desktop split)
  const [copied, setCopied] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const draggingRef = React.useRef(false)

  // Restore persisted split ratio.
  React.useEffect(() => {
    try {
      const v = parseFloat(localStorage.getItem(SPLIT_KEY) || '')
      if (!Number.isNaN(v) && v >= MIN_RATIO && v <= MAX_RATIO) setRatio(v)
    } catch {
      /* localStorage unavailable — keep default */
    }
  }, [])

  // Drag-to-resize the splitter (desktop only).
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const r = (e.clientX - rect.left) / rect.width
      setRatio(Math.min(MAX_RATIO, Math.max(MIN_RATIO, r)))
    }
    const onUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try {
        setRatio((r) => {
          localStorage.setItem(SPLIT_KEY, String(r))
          return r
        })
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const startDrag = () => {
    draggingRef.current = true
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

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

  const videoPane = (
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
  )

  const boardPane = boardUuid ? (
    <BoardCanvasClient
      boardUuid={boardUuid}
      accessToken={accessToken}
      orgslug={orgslug}
      username={username}
    />
  ) : null

  // No board attached → just the video, full screen (with a copy-link button).
  if (!boardUuid) {
    return (
      <div className="relative h-screen w-full bg-[#f8f8f8]">
        {videoPane}
        <RoomControls
          hasBoard={false}
          isDesktop={isDesktop}
          view={view}
          setView={setView}
          copied={copied}
          onCopy={copyLink}
        />
      </div>
    )
  }

  // On mobile, "split" collapses to the video tab.
  const effectiveView: View = isDesktop ? view : view === 'split' ? 'video' : view

  return (
    <div className="relative h-screen w-full bg-[#f8f8f8]">
      <RoomControls
        hasBoard
        isDesktop={isDesktop}
        view={view}
        setView={setView}
        copied={copied}
        onCopy={copyLink}
      />

      {isDesktop && effectiveView === 'split' ? (
        <div ref={containerRef} className="flex h-full w-full">
          <div className="h-full min-w-0" style={{ flexBasis: `${ratio * 100}%` }}>
            {videoPane}
          </div>
          {/* Draggable splitter */}
          <div
            role="separator"
            aria-orientation="vertical"
            onPointerDown={startDrag}
            className="group relative w-1.5 shrink-0 cursor-col-resize bg-gray-200 hover:bg-gray-300 transition-colors"
            title="Drag to resize"
          >
            <div className="absolute left-1/2 top-1/2 flex h-10 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white nice-shadow text-gray-400 group-hover:text-gray-600">
              <GripVertical size={14} />
            </div>
          </div>
          <div className="h-full min-w-0 flex-1 border-l border-gray-200">
            {boardPane}
          </div>
        </div>
      ) : (
        // video-only / board-only (and all mobile views): one full pane.
        <div className="h-full w-full">
          <div className={effectiveView === 'video' ? 'h-full w-full' : 'hidden'}>
            {videoPane}
          </div>
          <div className={effectiveView === 'board' ? 'h-full w-full' : 'hidden'}>
            {boardPane}
          </div>
        </div>
      )}
    </div>
  )
}

function RoomControls({
  hasBoard,
  isDesktop,
  view,
  setView,
  copied,
  onCopy,
}: {
  hasBoard: boolean
  isDesktop: boolean
  view: View
  setView: (v: View) => void
  copied: boolean
  onCopy: () => void
}) {
  const btn = (active: boolean) =>
    `flex items-center justify-center h-8 w-8 rounded-md transition-colors ${
      active ? 'bg-black text-white' : 'text-gray-500 hover:bg-gray-100'
    }`

  return (
    <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-xl bg-white/95 backdrop-blur px-1.5 py-1 nice-shadow">
      {hasBoard && (
        <>
          <button className={btn(view === 'video')} title="Video only" onClick={() => setView('video')}>
            <VideoIcon size={16} />
          </button>
          {isDesktop && (
            <button className={btn(view === 'split')} title="Split view" onClick={() => setView('split')}>
              <Columns2 size={16} />
            </button>
          )}
          <button className={btn(view === 'board')} title="Board only" onClick={() => setView('board')}>
            <LayoutDashboard size={16} />
          </button>
          <div className="mx-0.5 h-5 w-px bg-gray-200" />
        </>
      )}
      <button
        className="flex items-center gap-1.5 rounded-md px-2 h-8 text-sm text-gray-600 hover:bg-gray-100 transition-colors"
        title="Copy the live link to share"
        onClick={onCopy}
      >
        {copied ? <Check size={16} className="text-green-600" /> : <Link2 size={16} />}
        <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy link'}</span>
      </button>
    </div>
  )
}
