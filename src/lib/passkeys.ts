/**
 * Shared passkey metadata and recovery-code formatting. This module is safe to
 * import from both the browser and the server: it contains no secrets and no
 * WebAuthn implementation.
 */

export interface PasskeySummary {
  id: string
  name: string
  createdAt: number
  lastUsedAt: number | null
  deviceType: string
  backedUp: boolean
}

/** Recovery codes are compared without case, spaces, or grouping dashes. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Group a raw recovery-code string into five-character chunks for display. */
export function formatRecoveryCode(raw: string): string {
  const normalized = normalizeRecoveryCode(raw)
  return normalized.match(/.{1,5}/g)?.join('-') ?? ''
}
