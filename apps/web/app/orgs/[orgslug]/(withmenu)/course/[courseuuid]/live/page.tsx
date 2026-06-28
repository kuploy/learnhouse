import { Metadata } from 'next'
import React from 'react'
import { redirect } from 'next/navigation'
import { getServerSession } from '@/lib/auth/server'
import LiveClassroom from '@components/Pages/LiveClassroom/LiveClassroom'

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Live Classroom',
    description: 'Join the live classroom',
    robots: { index: false, follow: false },
  }
}

const LiveClassroomPage = async (props: any) => {
  const params = await props.params
  const searchParams = (await props.searchParams) || {}

  const orgslug: string = params.orgslug
  const courseuuid: string = params.courseuuid

  // The live room is keyed on a lesson (activity) when one is supplied,
  // otherwise the whole course shares one room.
  const activityUuid: string | null =
    typeof searchParams.activity === 'string' ? searchParams.activity : null
  // Optional board rendered beside the video grid.
  const boardUuid: string | null =
    typeof searchParams.board === 'string'
      ? searchParams.board.startsWith('board_')
        ? searchParams.board
        : `board_${searchParams.board}`
      : null
  const audioOnly = searchParams.audio === '1' || searchParams.audio === 'true'

  const session = await getServerSession()
  const access_token = session?.tokens?.access_token

  // Live classrooms require a real authenticated session — the user joins as
  // themselves.
  if (!access_token) {
    redirect(orgslug ? `/orgs/${orgslug}/login` : '/login')
  }

  return (
    <LiveClassroom
      courseUuid={courseuuid}
      activityUuid={activityUuid}
      boardUuid={boardUuid}
      accessToken={access_token}
      orgslug={orgslug}
      username={session?.user?.username || session?.user?.email || 'Anonymous'}
      audioOnly={audioOnly}
    />
  )
}

export default LiveClassroomPage
