export const UI_BRANDING = {
  showSignature: true,
  signatureText: 'YABUJIN',
  signatureTagline: 'Rainwater Systems',
  buildVersion: (import.meta.env.VITE_BUILD_VERSION as string | undefined)?.trim() || 'dev',
} as const
