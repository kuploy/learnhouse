/**
 * FORK (kuploy-cloud#1443): the Academy's end of the instance's sign-in.
 *
 * The path is the contract. The instance builds its one OAuth client's
 * redirect URL as `https://<academy hostname>/auth/callback/kuploy`, so this
 * route's name cannot change on its own.
 *
 * Mirrors `app/auth/callback/google/page.tsx`, minus two things it does not
 * need: there is no userinfo call (the id_token carries the claims) and no
 * fallback to a second backend endpoint. The id_token is passed straight to
 * `/api/auth/oauth`, which verifies it there — nothing here trusts it.
 */

'use client'

import React, { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Loader2, AlertTriangle, ShieldAlert } from 'lucide-react'
import Link from 'next/link'
import { useAuth, validateOAuthState } from '@components/Contexts/AuthContext'

export default function KuployCallbackPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { signIn } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<
    'loading' | 'success' | 'error' | 'csrf_error'
  >('loading')

  useEffect(() => {
    const handleCallback = async () => {
      const code = searchParams.get('code')
      const state = searchParams.get('state')
      const errorParam = searchParams.get('error')

      if (errorParam) {
        // The trainee said "Not now" on the consent screen, or the instance
        // refused the request.
        setError(`Sign-in was not completed: ${errorParam}`)
        setStatus('error')
        return
      }

      if (!code) {
        setError('No authorization code received')
        setStatus('error')
        return
      }

      if (!state) {
        setError('Missing state parameter - potential security issue')
        setStatus('csrf_error')
        return
      }

      // NO CUSTOM-DOMAIN BOUNCE HERE, unlike the Google callback, and it is
      // not an omission.
      //
      // Google allows one registered redirect URI per client, so a sign-in
      // started on a custom domain has to land on the main domain and be
      // forwarded back to the origin holding its CSRF and PKCE cookies. This
      // provider is ours: the instance registers the operator's own Academy
      // hostname (kuploy-cloud `auth/academy-sso.ts:98`, `:173`), better-auth
      // compares redirect_uri by exact string, and `signIn('kuploy')` sends
      // `window.location.origin`. So a code can only ever be issued to the
      // origin that asked for one, and this page is always already there.
      //
      // A bounce would therefore be unreachable for any real sign-in and
      // reachable only by a forged `state`: it has to run before
      // `validateOAuthState` (the CSRF cookie is on the other origin), so it
      // would read an attacker's `returnOrigin` out of an unvalidated state
      // and hand them the authorization code. Raised by `sso-review` on
      // learnhouse#32; PKCE and the server-held client secret stop the code
      // being redeemable, but there is no reason to send it at all.
      //
      // One case the removal does cost, for five minutes at a rollout. An
      // operator who saved the main LearnHouse domain as their Academy
      // hostname, with a trainee starting on a mapped custom domain, had the
      // old main-domain redirect_uri accepted — so a code issued just before
      // the deploy lands here with a differing `returnOrigin` and now fails
      // CSRF quietly instead of bouncing. `validateOAuthState` caps the state
      // at five minutes, and in that same configuration the new redirect_uri
      // is refused outright, so nothing can replace those codes. Measured by
      // `sso-review` at the merge-base `3d4b36aa`.

      const stateValidation = validateOAuthState(state)
      if (!stateValidation.valid) {
        setError('Invalid or expired sign-in request. Please try again.')
        setStatus('csrf_error')
        return
      }

      const callbackUrl = stateValidation.callbackUrl

      let orgId: number | undefined
      try {
        const cookies = document.cookie.split(';')
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=')
          if (name === 'LH_oauth_org_id' && value) {
            orgId = parseInt(value, 10)
            if (isNaN(orgId)) {
              orgId = undefined
            }
            break
          }
        }
      } catch {
        // Ignore cookie parsing errors
      }

      try {
        // Must match the redirect_uri sent at authorize, which is the one the
        // instance has stored for this client: the operator's Academy
        // hostname, i.e. the origin this page is being served from.
        const oauthRedirectUri = `${window.location.origin}/auth/callback/kuploy`

        const tokenResponse = await fetch('/api/auth/kuploy/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, redirect_uri: oauthRedirectUri }),
        })

        if (!tokenResponse.ok) {
          const errorData = await tokenResponse.json().catch(() => ({}))
          throw new Error(errorData.error || 'Could not complete sign-in')
        }

        const tokenData = await tokenResponse.json()

        if (!tokenData.id_token) {
          throw new Error('Invalid token response')
        }

        const oauthUrl = orgId
          ? `/api/auth/oauth?org_id=${orgId}`
          : '/api/auth/oauth'

        const oauthResponse = await fetch(oauthUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // No `email`: the id_token's own verified claim owns the account,
          // and the API reads it from there.
          body: JSON.stringify({
            provider: 'kuploy',
            id_token: tokenData.id_token,
          }),
          credentials: 'include',
        })

        if (!oauthResponse.ok) {
          const errorData = await oauthResponse.json().catch(() => ({}))
          throw new Error(errorData.detail || 'Failed to authenticate')
        }

        const data = await oauthResponse.json()

        if (!data.tokens?.access_token) {
          throw new Error('Invalid response from server')
        }

        const result = await signIn('credentials', {
          redirect: false,
          sso: 'true',
          sso_access_token: data.tokens.access_token,
          sso_refresh_token: data.tokens.refresh_token,
          sso_user: JSON.stringify(data.user),
          sso_expiry: data.tokens.expiry,
          callbackUrl,
        })

        if (result && !result.ok) {
          throw new Error(result.error || 'Failed to complete sign in')
        }

        setStatus('success')
        router.push(callbackUrl)
      } catch (err: any) {
        console.error('Kuploy sign-in callback error:', err)
        setError(err.message || 'Sign-in failed')
        setStatus('error')
      }
    }

    handleCallback()
  }, [searchParams, router, signIn])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <Loader2 className="w-12 h-12 text-gray-600 animate-spin" />
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            Completing sign in...
          </h1>
          <p className="text-gray-500">Please wait while we authenticate you.</p>
        </div>
      </div>
    )
  }

  if (status === 'csrf_error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-amber-100 rounded-full">
              <ShieldAlert className="w-12 h-12 text-amber-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            Security Check Failed
          </h1>
          <p className="text-gray-600 mb-2">{error}</p>
          <p className="text-gray-500 text-sm mb-6">
            This can happen if the sign-in took too long or if you followed an
            old link. Please start again.
          </p>
          <div className="space-y-3">
            <Link
              href="/auth/login"
              className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
            >
              Go to Login
            </Link>
            <Link
              href="/"
              className="block w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md mx-auto p-6">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-red-100 rounded-full">
              <AlertTriangle className="w-12 h-12 text-red-600" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            Sign-in Failed
          </h1>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="space-y-3">
            <Link
              href="/auth/login"
              className="block w-full py-2 px-4 bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
            >
              Try Again
            </Link>
            <Link
              href="/"
              className="block w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200 transition-colors"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <Loader2 className="w-12 h-12 text-green-600 animate-spin" />
        </div>
        <h1 className="text-xl font-semibold text-gray-800 mb-2">Success!</h1>
        <p className="text-gray-500">Redirecting you now...</p>
      </div>
    </div>
  )
}
