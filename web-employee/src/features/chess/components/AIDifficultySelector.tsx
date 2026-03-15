import type { ChessAIDifficulty } from '../types'

const OPTIONS: ChessAIDifficulty[] = ['EASY', 'MEDIUM', 'HARD']

export function AIDifficultySelector({
  value,
  onChange,
}: {
  value: ChessAIDifficulty
  onChange: (value: ChessAIDifficulty) => void
}) {
  return (
    <div className="yabuchess-inline-options">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`yabuchess-inline-option ${value === option ? 'is-active' : ''}`}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  )
}

