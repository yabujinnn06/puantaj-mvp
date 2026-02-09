import { UI_BRANDING } from '../config/ui'

export function BrandSignature() {
  if (!UI_BRANDING.showSignature) {
    return null
  }

  return (
    <div className="employee-signature" aria-hidden="true">
      <p>{UI_BRANDING.signatureText}</p>
      <p>Build: {UI_BRANDING.buildVersion}</p>
    </div>
  )
}
