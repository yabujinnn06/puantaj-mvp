import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

export function ChessStageLayout({
  title,
  kicker,
  children,
  extra,
}: {
  title: string
  kicker: string
  children: ReactNode
  extra?: ReactNode
}) {
  const location = useLocation()
  const tabs = [
    { to: '/yabuchess', label: 'LOBI' },
    { to: '/yabuchess/leaderboard', label: 'RANK' },
    { to: '/yabuchess/history', label: 'HISTORY' },
    { to: '/yabuchess/profile', label: 'PROFILE' },
  ]

  return (
    <main className="yabuchess-stage-page">
      <section className="yabuchess-stage-shell">
        <div className="yabuchess-world" aria-hidden="true">
          <span className="yabuchess-world-moon" />
          <span className="yabuchess-world-ridge yabuchess-world-ridge--back" />
          <span className="yabuchess-world-ridge yabuchess-world-ridge--front" />
          <span className="yabuchess-world-tower yabuchess-world-tower--left" />
          <span className="yabuchess-world-tower yabuchess-world-tower--right" />
          <span className="yabuchess-world-banner yabuchess-world-banner--left" />
          <span className="yabuchess-world-banner yabuchess-world-banner--right" />
          <span className="yabuchess-world-mist yabuchess-world-mist--one" />
          <span className="yabuchess-world-mist yabuchess-world-mist--two" />
          <span className="yabuchess-world-flame yabuchess-world-flame--left" />
          <span className="yabuchess-world-flame yabuchess-world-flame--right" />
        </div>

        <div className="yabuchess-screen-hud">
          <div className="yabuchess-screen-brand">
            <p>{kicker}</p>
            <h1>{title}</h1>
          </div>
          <div className="yabuchess-screen-status yabuchess-screen-status--nav">
            {tabs.map((tab) => (
              <Link key={tab.to} className={`yabuchess-nav-link ${location.pathname === tab.to ? 'is-active' : ''}`} to={tab.to}>
                {tab.label}
              </Link>
            ))}
          </div>
          <div className="yabuchess-screen-actions">
            <Link className="yabuchess-screen-btn yabuchess-screen-btn--link" to="/">
              CIK
            </Link>
          </div>
        </div>

        <section className="yabuchess-hub">{children}{extra}</section>
      </section>
    </main>
  )
}

