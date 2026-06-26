import { useState, useEffect } from 'react'
import socket from '../socket'

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }
const TIER_EMOJI = { Diamante: '💎', Oro: '🥇', Plata: '🥈', Bronce: '🥉' }
const TIER_ORDER = ['Diamante', 'Oro', 'Plata', 'Bronce']

export default function TournamentList({ user, myStats, onEnter }) {
  const [tournaments, setTournaments] = useState([])

  useEffect(() => {
    function fetch() {
      socket.emit('get_tournaments', (res) => {
        if (res?.ok) setTournaments(res.tournaments)
      })
    }
    fetch()
    const interval = setInterval(fetch, 15_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="tl">
      <p className="tl__hint">Entra en el torneo de tu nivel y reta a otros jugadores</p>
      {TIER_ORDER.map(tierName => {
        const t = tournaments.find(t => t.tier === tierName)
        if (!t) return null
        const myTier = myStats?.tier
        const isMyTier = myTier === tierName
        const color = TIER_COLOR[tierName]
        return (
          <div key={t.id} className={`tl__card${isMyTier ? ' tl__card--mine' : ''}`} onClick={() => onEnter(t)}>
            <span className="tl__card-emoji">{TIER_EMOJI[tierName]}</span>
            <div className="tl__card-body">
              <p className="tl__card-name">{t.name}</p>
              <p className="tl__card-meta">
                {t.playerCount} en sala. {t.openRooms} {t.openRooms === 1 ? 'Partida abierta' : 'Partidas abiertas'}
                {t.activeGames > 0 && ` · ${t.activeGames} en curso`}
              </p>
            </div>
            {isMyTier && <span className="tl__badge">Tu nivel</span>}
          </div>
        )
      })}
      {!user && (
        <p className="tl__login-hint">Inicia sesión para ver tu nivel y poder jugar en torneos</p>
      )}
    </div>
  )
}
