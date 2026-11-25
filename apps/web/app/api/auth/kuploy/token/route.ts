/**
 * FORK (kuploy-cloud#1443): exchange the instance's authorization code for an
 * id_token.
 *
 * Mirrors `app/api/auth/google/token/route.ts`. The client secret and the PKCE
 * verifier both stay server-side: the secret comes from the environment, the
 * verifier from the HttpOnly cookie `../authorize/route.ts` set.
 *
 * Only `id_token` is returned to the browser. The instance also issues an
 * access token, and the Academy has no use for it — it reads the account from
 * the id_token's own verified claims, so handing the browser a bearer token
 * for somebody else's API would be a credential with no purpose here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { KUPLOY_VERIFIER_COOKIE } from '../pkce'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { code, redirect_uri } = body

    if (!code || !redirect_uri) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      )
    }

    const clientId = process.env.LEARNHOUSE_KUPLOY_CLIENT_ID
    const clientSecret = process.env.LEARNHOUSE_KUPLOY_CLIENT_SECRET
    const issuer = process.env.LEARNHOUSE_KUPLOY_ISSUER

    if (!clientId || !clientSecret || !issuer) {
      return NextResponse.json(
        { error: 'Sign-in with this site is not configured' },
        { status: 500 }
      )
    }

    const verifier = request.cookies.get(KUPLOY_VERIFIER_COOKIE)?.value
    if (!verifier) {
      // The sign-in was started more than ten minutes ago, or in another
      // browser. Sending the exchange without a verifier would fail at the
      // instance anyway, with a message nobody can act on.
      return NextResponse.json(
        { error: 'This sign-in took too long. Please try again.' },
        { status: 400 }
      )
    }

    const tokenResponse = await fetch(new URL('/api/auth/oauth2/token', issuer), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error('Kuploy token exchange failed:', errorData)
      return NextResponse.json(
        { error: errorData.error_description || 'Token exchange failed' },
        { status: tokenResponse.status }
      )
    }

    const tokenData = await tokenResponse.json()

    if (!tokenData.id_token) {
      console.error('Kuploy token exchange returned no id_token')
      return NextResponse.json(
        { error: 'Token exchange failed' },
        { status: 502 }
      )
    }

    const response = NextResponse.json({ id_token: tokenData.id_token })
    // One code, one exchange: the verifier is spent.
    response.cookies.set(KUPLOY_VERIFIER_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(request.url).protocol === 'https:',
      path: '/',
      maxAge: 0,
    })
    return response
  } catch (error: any) {
    console.error('Kuploy token exchange error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
