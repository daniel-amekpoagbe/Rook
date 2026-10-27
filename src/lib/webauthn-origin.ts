/**
 * Resolve the WebAuthn origin and RP ID from proxy headers or explicit
 * overrides. Kept pure so it can be tested without a server request.
 */
export interface RelyingParty {
  origin: string
  rpID: string
}

export interface RelyingPartyInput {
  originOverride?: string
  rpIdOverride?: string
  forwardedHost?: string | null
  forwardedProto?: string | null
  host?: string | null
  fallbackOrigin?: string | null
}

function firstHeaderValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const first = value.split(',')[0]?.trim()
  return first || undefined
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

export function resolveRelyingParty(input: RelyingPartyInput): RelyingParty {
  const originOverride = input.originOverride?.trim()
  const rpIdOverride = input.rpIdOverride?.trim()

  if (originOverride || rpIdOverride) {
    if (!originOverride || !rpIdOverride) throw new Error('WEBAUTHN_CONFIG')

    let origin: URL
    try {
      origin = new URL(originOverride)
    } catch {
      throw new Error('WEBAUTHN_CONFIG')
    }
    if (origin.protocol !== 'https:' && origin.protocol !== 'http:') {
      throw new Error('WEBAUTHN_CONFIG')
    }

    const rpID = rpIdOverride.replace(/\.$/, '').toLowerCase()
    if (!rpID) throw new Error('WEBAUTHN_CONFIG')
    return { origin: origin.origin, rpID }
  }

  let host = firstHeaderValue(input.forwardedHost) ?? firstHeaderValue(input.host)
  let protocol = firstHeaderValue(input.forwardedProto)?.toLowerCase()

  if (!host && input.fallbackOrigin) {
    try {
      const fallback = new URL(input.fallbackOrigin)
      host = fallback.host
      protocol = fallback.protocol.replace(':', '')
    } catch {
      // Fall through to the missing-host error below.
    }
  }

  if (!host) throw new Error('WEBAUTHN_CONFIG')

  let parsed: URL
  try {
    parsed = new URL(`${protocol === 'http' ? 'http' : 'https'}://${host}`)
  } catch {
    throw new Error('WEBAUTHN_CONFIG')
  }

  if (!protocol) {
    protocol = isLocalHostname(parsed.hostname) ? 'http' : 'https'
  }
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error('WEBAUTHN_CONFIG')
  }

  const rpID = parsed.hostname.replace(/\.$/, '').toLowerCase()
  if (!rpID) throw new Error('WEBAUTHN_CONFIG')

  return { origin: `${protocol}://${parsed.host}`, rpID }
}
