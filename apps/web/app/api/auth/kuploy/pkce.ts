/**
 * FORK (kuploy-cloud#1443): the PKCE verifier shared by the two Kuploy
 * sign-in routes next to this file.
 *
 * It lives in its own module rather than in `authorize/route.ts` because a
 * Next.js App Router route file may only export route handlers and route
 * config — exporting a constant from one fails the build's route type check.
 */

/** Holds the verifier between `authorize` and `token`. HttpOnly: never JS-readable. */
export const KUPLOY_VERIFIER_COOKIE = 'LH_kuploy_pkce'

/** How long the browser may sit on the instance's sign-in page. */
export const KUPLOY_VERIFIER_MAX_AGE_SECONDS = 10 * 60

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

export async function kuployPkcePair(): Promise<{
  verifier: string
  challenge: string
}> {
  const random = new Uint8Array(32)
  crypto.getRandomValues(random)
  const verifier = base64url(random)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier)
  )
  return { verifier, challenge: base64url(new Uint8Array(digest)) }
}
