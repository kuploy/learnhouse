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
import { getLEARNHOUSE_DOMAIN_VAL } from '@services/config/config'

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

      // Same custom-domain bounce as the Google flow: the instance only knows
      // one redirect URL, the main domain's, so a sign-in started on a custom
      // domain lands here and is forwarded back to the origin that started it
      // — where the CSRF cookie and the PKCE cookie both live.
      try {
        const stateData = JSON.parse(atob(state))
        if (
          stateData.returnOrigin &&
          stateData.returnOrigin !== window.location.origin
        ) {
          const bounceUrl = new URL(
            '/auth/callback/kuploy',
            stateData.returnOrigin
          )
          searchParams.forEach((value, key) => {
            bounceUrl.searchParams.set(key, value)
          })
          window.location.href = bounceUrl.toString()
          return
        }
      } catch {
        // State parsing failed; CSRF validation below reports it.
      }

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
        // instance has stored for this client: always the main domain.
        const domain = getLEARNHOUSE_DOMAIN_VAL()
        const oauthRedirectUri = `${window.location.protocol}//${domain}/auth/callback/kuploy`

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
