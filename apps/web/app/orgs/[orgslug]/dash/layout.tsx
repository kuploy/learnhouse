import { Metadata } from 'next'
import React from 'react'
import ClientAdminLayout from './ClientAdminLayout'
import { getOrganizationContextInfo } from '@services/organizations/orgs'

// FORK (kuploy-learnhouse#37): the tab names the organization.
export async function generateMetadata(props: { params: Promise<any> }): Promise<Metadata> {
  const { orgslug } = await props.params
  try {
    const org = await getOrganizationContextInfo(orgslug, { revalidate: 86400, tags: ['organizations'] })
    if (org?.name) return { title: `${org.name} Dashboard` }
  } catch {
    // keep the defaults when the org cannot be loaded
  }
  return { title: 'LearnHouse Dashboard' }
}

async function DashboardLayout(
  props: {
    children: React.ReactNode
    params: Promise<any>
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  return (
    <>
      <ClientAdminLayout
        params={params}>
        {children}
      </ClientAdminLayout>
    </>
  )
}

export default DashboardLayout
