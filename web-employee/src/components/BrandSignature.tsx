import { UI_BRANDING } from '../config/ui'

export function BrandSignature() {
  if (!UI_BRANDING.showSignature) {
    return null
  }

  return (
    <div className="employee-signature" aria-hidden="true">
      <p className="employee-signature-main">{UI_BRANDING.signatureText}</p>
      <p className="employee-signature-sub">{UI_BRANDING.signatureTagline}</p>
      <p className="employee-signature-build">BUILD: {UI_BRANDING.buildVersion}</p>
    </div>
  )
}
