/**
 * FORK (kuploy-cloud#1443): the two facts the login page needs about the
 * Kuploy instance that runs this Academy — whether it can sign people in, and
 * what to call it on the button.
 *
 * WHY THIS IS NOT A FETCH FROM THE CLIENT. It was one, and it made the login
 * page render twice: `kuployName` started null, so the first paint was the
 * ordinary card — password field, Google, sign-up link — and the fetch then
 * collapsed it. For that round-trip the sign-up link was clickable, which is
 * the one thing the configured page exists to remove.
 *
 * Nothing here is async and nothing here is a secret: it is two environment
 * variables and a URL parse. So the login page's server component resolves it
 * and hands the answer down as a prop, and there is no second paint.
 *
 * The client ids and the secret stay server-side. `siteName` is the only
 * string that crosses, and it is the operator's own site name.
 */

export interface KuploySignIn {
  configured: boolean
  siteName: string | null
}

const NOT_CONFIGURED: KuploySignIn = { configured: false, siteName: null }

export function resolveKuploySignIn(): KuploySignIn {
  const clientId = process.env.LEARNHOUSE_KUPLOY_CLIENT_ID
  const issuer = process.env.LEARNHOUSE_KUPLOY_ISSUER

  if (!clientId || !issuer) return NOT_CONFIGURED

  let hostname: string
  try {
    hostname = new URL(issuer).hostname
  } catch {
    // A malformed issuer is a misconfiguration, not a sign-in option.
    return NOT_CONFIGURED
  }

  return {
    configured: true,
    siteName: process.env.LEARNHOUSE_KUPLOY_SITE_NAME || hostname,
  }
}
