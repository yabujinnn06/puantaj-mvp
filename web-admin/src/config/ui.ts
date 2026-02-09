export const UI_BRANDING = {
  showSignature: true,
  signatureText: 'Made by yabujin',
  buildVersion: (import.meta.env.VITE_BUILD_VERSION as string | undefined)?.trim() || 'dev',
} as const
