'use client'
// FORK (kuploy-learnhouse#37)
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { cn } from '@/lib/utils'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgLogoMediaDirectory } from '@services/media/media'

/**
 * The organization's logo, or `children` (the built-in mark) when it has none.
 * `orgslug` is for pages with no OrgProvider around them (boards, playgrounds).
 */
export default function BrandMark({
  children,
  className,
  orgslug,
}: {
  children: React.ReactNode
  className?: string
  orgslug?: string
}) {
  const contextOrg = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token
  const { data: fetchedOrg } = useQuery({
    queryKey: queryKeys.org.detail(orgslug || ''),
    queryFn: () => getOrganizationContextInfo(orgslug!, {}, accessToken),
    staleTime: 5 * 60_000,
    enabled: !contextOrg && !!orgslug,
  })
  const org = contextOrg || fetchedOrg

  if (!org?.logo_image) return <>{children}</>

  return (
    <img
      src={getOrgLogoMediaDirectory(org.org_uuid, org.logo_image)}
      alt={org.name}
      className={cn('object-contain rounded', className)}
    />
  )
}
