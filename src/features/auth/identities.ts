export const identities = [
  { id: 'ben', displayName: 'Ben', emoji: '🏡', email: 'ben@cubby.example' },
  { id: 'gabby', displayName: 'Gabby', emoji: '🌷', email: 'partner@cubby.example' },
] as const

export type Identity = (typeof identities)[number]

export function identityForEmail(email: string | undefined): Identity | null {
  return identities.find((identity) => identity.email.toLowerCase() === email?.toLowerCase()) ?? null
}
