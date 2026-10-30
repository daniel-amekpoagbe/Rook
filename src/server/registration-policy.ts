/**
 * A public deploy can create the first vault, then stops accepting accounts.
 * Local development and tests stay open. ROOK_ALLOW_REGISTRATION overrides both.
 */
export function registrationAllowed(input: {
  flag: string | undefined
  publicDeployment: boolean
  userCount: number
}): boolean {
  if (input.flag === 'true') return true
  if (input.flag === 'false') return false
  if (!input.publicDeployment) return true
  return input.userCount === 0
}
