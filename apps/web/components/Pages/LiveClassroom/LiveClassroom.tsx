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
  PictureInPicture2,
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
// Floating "pop-out" video tile size (Board-only view).
const FLOAT_W = 288
const FLOAT_H = 180

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
  const [floatPos, setFloatPos] = React.useState<{ x: number; y: number } | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const draggingRef = React.useRef(false)
  const floatDragRef = React.useRef<{ dx: number; dy: number } | null>(null)

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

  // Drag the floating "pop-out" video tile (Board-only view).
  React.useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const off = floatDragRef.current
      if (!off || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.min(rect.width - FLOAT_W, Math.max(0, e.clientX - rect.left - off.dx))
      const y = Math.min(rect.height - FLOAT_H, Math.max(0, e.clientY - rect.top - off.dy))
      setFloatPos({ x, y })
    }
    const onUp = () => {
      if (floatDragRef.current) {
        floatDragRef.current = null
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const startFloatDrag = (e: React.PointerEvent) => {
    const tile = (e.currentTarget as HTMLElement).parentElement
    if (!tile) return
    const r = tile.getBoundingClientRect()
    floatDragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    document.body.style.userSelect = 'none'
  }

  // Native Picture-in-Picture: float the active video tile over other apps.
  // Single-element PiP (broadly supported); a full-grid pop-out window via the
  // Document PiP API is tracked separately.
  const [pipSupported, setPipSupported] = React.useState(false)
  React.useEffect(() => {
    setPipSupported(
      typeof document !== 'undefined' && (document as any).pictureInPictureEnabled === true,
    )
  }, [])

  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        return
      }
      const vids = Array.from(
        document.querySelectorAll<HTMLVideoElement>('video.lk-participant-media-video'),
      )
      const target =
        vids.find((v) => v.readyState >= 2 && v.videoWidth > 0) ||
        vids[0] ||
        document.querySelector('video')
      if (target && (target as any).requestPictureInPicture) {
        await (target as HTMLVideoElement).requestPictureInPicture()
      }
    } catch {
      /* PiP blocked or no active video — no-op */
    }
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
          pipSupported={pipSupported}
          onPip={togglePip}
        />
      </div>
    )
  }

  // On mobile, "split" collapses to the video tab.
  const effectiveView: View = isDesktop ? view : view === 'split' ? 'video' : view
  // Board-only on desktop pops the video out into a draggable floating tile.
  const floating = isDesktop && effectiveView === 'board'

  // Both panes are absolutely positioned and always mounted (just repositioned),
  // so toggling views never remounts the LiveKit room or the board (no reconnect).
  const videoStyle: React.CSSProperties = floating
    ? floatPos
      ? { left: floatPos.x, top: floatPos.y, width: FLOAT_W, height: FLOAT_H }
      : { right: 16, bottom: 16, width: FLOAT_W, height: FLOAT_H }
    : effectiveView === 'video'
      ? { inset: 0 }
      : isDesktop && effectiveView === 'split'
        ? { left: 0, top: 0, width: `${ratio * 100}%`, height: '100%' }
        : { display: 'none' } // mobile board tab — hide video, audio keeps playing

  const boardStyle: React.CSSProperties =
    effectiveView === 'board'
      ? { inset: 0 }
      : isDesktop && effectiveView === 'split'
        ? { left: `${ratio * 100}%`, top: 0, right: 0, height: '100%' }
        : { display: 'none' }

  return (
    <div ref={containerRef} className="relative h-screen w-full overflow-hidden bg-[#f8f8f8]">
      <RoomControls
        hasBoard
        isDesktop={isDesktop}
        view={view}
        setView={setView}
        copied={copied}
        onCopy={copyLink}
        pipSupported={pipSupported}
        onPip={togglePip}
      />

      {/* Board */}
      <div className="absolute" style={boardStyle}>
        {boardPane}
      </div>

      {/* Draggable splitter (desktop split only) */}
      {isDesktop && effectiveView === 'split' && (
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startDrag}
          className="group absolute top-0 z-20 h-full w-3 -translate-x-1/2 cursor-col-resize"
          style={{ left: `${ratio * 100}%` }}
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-gray-200 group-hover:bg-gray-300 transition-colors" />
          <div className="absolute left-1/2 top-1/2 flex h-10 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white nice-shadow text-gray-400 group-hover:text-gray-600">
            <GripVertical size={14} />
          </div>
        </div>
      )}

      {/* Video — in-flow pane in split/video, floating pop-out tile in Board view */}
      <div
        className={`absolute overflow-hidden ${
          floating ? 'rounded-xl shadow-2xl ring-1 ring-black/10 z-40' : ''
        }`}
        style={videoStyle}
      >
        {floating && (
          <div
            onPointerDown={startFloatDrag}
            className="absolute inset-x-0 top-0 z-10 flex h-6 cursor-move items-center justify-center bg-black/40 text-white/80 hover:bg-black/50"
            title="Drag the video"
          >
            <GripVertical size={12} className="rotate-90" />
          </div>
        )}
        <div className="h-full w-full">{videoPane}</div>
      </div>
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
  pipSupported,
  onPip,
}: {
  hasBoard: boolean
  isDesktop: boolean
  view: View
  setView: (_v: View) => void
  copied: boolean
  onCopy: () => void
  pipSupported: boolean
  onPip: () => void
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
      {pipSupported && (
        <button
          className={btn(false)}
          title="Pop out video (Picture-in-Picture)"
          onClick={onPip}
        >
          <PictureInPicture2 size={16} />
        </button>
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
