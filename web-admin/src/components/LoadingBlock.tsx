export function LoadingBlock({ label = 'Yükleniyor...' }: { label?: string }) {
  return (
    <div
      className="loading-block admin-panel rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="loading-block__visual" aria-hidden="true">
        <div className="welcome-hero-logo welcome-hero-logo--loader">
          <div className="welcome-hero-logo__shadow" />
          <div className="welcome-hero-logo__nebula welcome-hero-logo__nebula--back" />
          <div className="welcome-hero-logo__nebula welcome-hero-logo__nebula--front" />
          <div className="welcome-hero-logo__aura" />
          <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--outer" />
          <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--mid" />
          <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--inner" />
          <div className="welcome-hero-logo__orbit welcome-hero-logo__orbit--polar" />
          <div className="welcome-hero-logo__satellite welcome-hero-logo__satellite--outer">
            <div className="welcome-hero-logo__satellite-core" />
          </div>
          <div className="welcome-hero-logo__satellite welcome-hero-logo__satellite--mid">
            <div className="welcome-hero-logo__satellite-core" />
          </div>
          <div className="welcome-hero-logo__satellite welcome-hero-logo__satellite--inner">
            <div className="welcome-hero-logo__satellite-core" />
          </div>
          <div className="welcome-hero-logo__planet">
            <div className="welcome-hero-logo__depth" />
            <div className="welcome-hero-logo__halo" />
            <div className="welcome-hero-logo__ring welcome-hero-logo__ring--back" />
            <div className="welcome-hero-logo__core loading-orbit-core">
              <span className="loading-orbit-core__dot" />
            </div>
            <div className="welcome-hero-logo__ring welcome-hero-logo__ring--front" />
            <div className="welcome-hero-logo__spark welcome-hero-logo__spark--a" />
            <div className="welcome-hero-logo__spark welcome-hero-logo__spark--b" />
          </div>
        </div>
      </div>
      <span className="loading-block__label">{label}</span>
    </div>
  )
}
