import { UI_BRANDING } from '../config/ui'

export function BrandSignature() {
  return (
    <div className="employee-signature">
      <p className="employee-signature-note">
        Konumunuz, izin verdiğiniz ölçüde mesai işlemleri için kullanılmaktadır.
      </p>
      {UI_BRANDING.showSignature ? (
        <div className="employee-signature-brand" aria-hidden="true">
          <p className="employee-signature-main">{UI_BRANDING.signatureText}</p>
          <p className="employee-signature-sub">{UI_BRANDING.signatureTagline}</p>
          <p className="employee-signature-build">BUILD: {UI_BRANDING.buildVersion}</p>
        </div>
      ) : null}
    </div>
  )
}
