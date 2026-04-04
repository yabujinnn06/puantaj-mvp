import { useEffect, useState, type ReactNode, type Ref } from 'react'

interface EmployeeHeaderMetaItem {
  label: string
  value: string
}

interface EmployeeHeaderProps {
  employeeName: string
  companyName: string
  statusClassName: string
  statusLabel: string
  subtitle: string
  metaItems: EmployeeHeaderMetaItem[]
}

interface EmployeeMainActionCardProps {
  statusClassName: string
  statusLabel: string
  title: string
  hint: string
  shiftSummary: string
  contextLine: string
  footerNote: string
  primaryAction: ReactNode
  secondaryAction: ReactNode
  sectionRef?: Ref<HTMLElement>
  children?: ReactNode
}

interface EmployeeLastActionSummaryProps {
  title: string
  summary: string
  timestampLabel?: string | null
  badges?: ReactNode
  details?: ReactNode
}

interface EmployeeCriticalAlertsProps {
  children: ReactNode
}

interface SecondaryFeaturesSectionProps {
  kicker: string
  title: string
  description: string
  badge?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}

export function EmployeeHeader({
  employeeName,
  companyName,
  statusClassName,
  statusLabel,
  subtitle,
  metaItems,
}: EmployeeHeaderProps) {
  return (
    <section className="employee-home-header-card" aria-label="Calisan ozeti">
      <div className="employee-home-header-row">
        <div className="employee-home-header-copy">
          <p className="employee-home-header-kicker">{companyName}</p>
          <h2 className="employee-home-header-title">{employeeName}</h2>
          <p className="employee-home-header-subtitle">{subtitle}</p>
        </div>
        <span className={`status-pill employee-home-header-status ${statusClassName}`}>{statusLabel}</span>
      </div>

      <dl className="employee-home-meta-grid">
        {metaItems.map((item) => (
          <div key={item.label} className="employee-home-meta-item">
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function EmployeeMainActionCard({
  statusClassName,
  statusLabel,
  title,
  hint,
  shiftSummary,
  contextLine,
  footerNote,
  primaryAction,
  secondaryAction,
  sectionRef,
  children,
}: EmployeeMainActionCardProps) {
  return (
    <section className="action-panel employee-main-action-card" ref={sectionRef}>
      <div className="employee-main-action-head">
        <div>
          <p className="employee-main-action-kicker">ANA ISLEM</p>
          <h2 className="employee-main-action-title">{title}</h2>
          <p className="employee-main-action-hint">{hint}</p>
        </div>
        <span className={`status-pill employee-main-action-status ${statusClassName}`}>{statusLabel}</span>
      </div>

      <div className="employee-main-action-stats" aria-label="Bugunku ozet">
        <article className="employee-main-action-stat">
          <span className="employee-main-action-stat-label">Vardiya</span>
          <strong className="employee-main-action-stat-value">{shiftSummary}</strong>
        </article>
        <article className="employee-main-action-stat">
          <span className="employee-main-action-stat-label">Durum</span>
          <strong className="employee-main-action-stat-value">{contextLine}</strong>
        </article>
      </div>

      <div className="employee-main-action-buttons">
        {primaryAction}
        {secondaryAction}
      </div>

      <p className="employee-main-action-note">{footerNote}</p>

      {children ? <div className="employee-main-action-extra">{children}</div> : null}
    </section>
  )
}

export function EmployeeLastActionSummary({
  title,
  summary,
  timestampLabel,
  badges,
  details,
}: EmployeeLastActionSummaryProps) {
  return (
    <section className="result-box employee-last-action-card" aria-labelledby="employee-last-action-title">
      <div className="employee-last-action-head">
        <div>
          <p className="employee-last-action-kicker">SON ISLEM</p>
          <h2 id="employee-last-action-title">{title}</h2>
        </div>
        {timestampLabel ? <span className="employee-last-action-time">{timestampLabel}</span> : null}
      </div>

      <p className="employee-last-action-copy">{summary}</p>

      {badges ? <div className="chips employee-last-action-badges">{badges}</div> : null}
      {details ? <div className="employee-last-action-details">{details}</div> : null}
    </section>
  )
}

export function EmployeeCriticalAlerts({ children }: EmployeeCriticalAlertsProps) {
  return (
    <section className="employee-alerts-card" aria-labelledby="employee-alerts-title">
      <div className="employee-alerts-head">
        <div>
          <p className="employee-alerts-kicker">ONEMLI UYARILAR</p>
          <h2 id="employee-alerts-title" className="employee-alerts-title">
            Kontrol etmeniz gereken durumlar
          </h2>
        </div>
      </div>
      <div className="employee-alerts-list">{children}</div>
    </section>
  )
}

export function SecondaryFeaturesSection({
  kicker,
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: SecondaryFeaturesSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  useEffect(() => {
    if (defaultOpen) {
      setIsOpen(true)
    }
  }, [defaultOpen])

  return (
    <details
      className="employee-secondary-section"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="employee-secondary-summary">
        <div className="employee-secondary-summary-copy">
          <p className="employee-secondary-kicker">{kicker}</p>
          <h2 className="employee-secondary-title">{title}</h2>
          <p className="employee-secondary-description">{description}</p>
        </div>
        {badge ? <div className="employee-secondary-badge">{badge}</div> : null}
      </summary>

      <div className="employee-secondary-content">{children}</div>
    </details>
  )
}
