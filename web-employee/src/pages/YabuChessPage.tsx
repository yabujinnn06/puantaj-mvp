import { Navigate, Route, Routes } from 'react-router-dom'

import { ChessHistoryPage } from '../features/chess/pages/ChessHistoryPage'
import { ChessLeaderboardPage } from '../features/chess/pages/ChessLeaderboardPage'
import { ChessLobbyPage } from '../features/chess/pages/ChessLobbyPage'
import { ChessMatchPage } from '../features/chess/pages/ChessMatchPage'
import { ChessProfilePage } from '../features/chess/pages/ChessProfilePage'

export function YabuChessPage() {
  return (
    <Routes>
      <Route index element={<ChessLobbyPage />} />
      <Route path="match/:matchId" element={<ChessMatchPage />} />
      <Route path="leaderboard" element={<ChessLeaderboardPage />} />
      <Route path="history" element={<ChessHistoryPage />} />
      <Route path="profile" element={<ChessProfilePage />} />
      <Route path="*" element={<Navigate to="/yabuchess" replace />} />
    </Routes>
  )
}
