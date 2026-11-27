import '../styles/globals.css'
import React from 'react'
import Providers from '@components/Providers'
import { Wix_Madefor_Text } from 'next/font/google'
import type { Metadata } from 'next'
import { getOrgSlug } from '@services/org/orgResolution'
import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { getOrgFaviconMediaDirectory } from '@services/media/media'

const wixMadeforText = Wix_Madefor_Text({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-default',
})

// FORK (kuploy-learnhouse#37): the operator's favicon on pages outside /orgs too.
export async function generateMetadata(): Promise<Metadata> {
  try {
    const orgslug = await getOrgSlug()
    if (!orgslug) return {}
    const org = await getOrganizationContextInfo(orgslug, {
      revalidate: 86400,
      tags: ['organizations'],
    })
    const faviconImage = org?.config?.config?.customization?.general?.favicon_image || org?.config?.config?.general?.favicon_image
    if (faviconImage) {
      return { icons: { icon: getOrgFaviconMediaDirectory(org.org_uuid, faviconImage) } }
    }
  } catch {
    // keep the defaults when the org cannot be loaded
  }
  return {}
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html className={wixMadeforText.variable} lang="en" suppressHydrationWarning>
      <head>
        {/* Synchronous script — blocks parsing to guarantee window.__RUNTIME_CONFIG__ exists before any JS runs.
            Next.js <Script strategy="beforeInteractive"> is not truly blocking in all browsers (Safari). */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/runtime-config.js" />
        {/* Prevent white flash on embed routes: set html+body bg before body is painted.
            Reads the optional ?bgcolor param (hex-validated) or defaults to dark. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/embed-bg.js" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <main className="animate-fade-in">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  )
}
