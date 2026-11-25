/**
 * FORK (kuploy-cloud#1443): start a sign-in on the Kuploy instance that runs
 * this Academy.
 *
 * Mirrors `app/api/auth/google/authorize/route.ts`, with one difference that
 * matters: this flow uses PKCE, and the code verifier never reaches the
 * browser. It is generated here, returned to the caller only as an HttpOnly
 * cookie, and read back server-side by `../token/route.ts`.
 *
 * The instance's provider (better-auth's oidcProvider) does accept a request
 * with no PKCE at all today, because `allowPlainCodeChallengeMethod` defaults
 * to true there and an absent challenge compares equal to an absent verifier.
 * Relying on that would make this Academy's sign-in depend on a default in
 * somebody else's package, so S256 is sent explicitly.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  KUPLOY_VERIFIER_COOKIE,
  KUPLOY_VERIFIER_MAX_AGE_SECONDS,
  kuployPkcePair,
} from '../pkce'
import { resolveKuploySignIn } from '@services/auth/kuploy'

/**
 * Whether this Academy has an instance to sign people in from, and what to
 * call it on the button. The login page does NOT call this — it resolves the
 * same two facts in its server component, so the card paints once
 * (`services/auth/kuploy.ts` says why). This stays as the HTTP answer to the
 * same question, and reads it from that one place rather than a second copy
 * of the env checks.
 */
export async function GET() {
  const { configured, siteName } = resolveKuploySignIn()
  return NextResponse.json({ configured, site_name: siteName })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { redirect_uri, state, scope } = body

    if (!redirect_uri) {
      return NextResponse.json(
        { error: 'Missing redirect_uri' },
        { status: 400 }
      )
    }

    const clientId = process.env.LEARNHOUSE_KUPLOY_CLIENT_ID
    const issuer = process.env.LEARNHOUSE_KUPLOY_ISSUER

    if (!clientId || !issuer) {
      return NextResponse.json(
        { error: 'Sign-in with this site is not configured' },
        { status: 500 }
      )
    }

    const { verifier, challenge } = await kuployPkcePair()

    // better-auth mounts the provider under its own basePath.
    const authorizeUrl = new URL('/api/auth/oauth2/authorize', issuer)
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('redirect_uri', redirect_uri)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('scope', scope || 'openid profile email')
    authorizeUrl.searchParams.set('state', state || '')
    authorizeUrl.searchParams.set('code_challenge', challenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')

    const response = NextResponse.json({ url: authorizeUrl.toString() })
    response.cookies.set(KUPLOY_VERIFIER_COOKIE, verifier, {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: KUPLOY_VERIFIER_MAX_AGE_SECONDS,
    })
    return response
  } catch (error: any) {
    console.error('Kuploy authorize error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
