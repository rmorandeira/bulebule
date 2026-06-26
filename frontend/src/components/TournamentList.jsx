import { useState, useEffect } from 'react'
import socket from '../socket'

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }
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
            <div className="tl__card-left">
              <span className="tl__tier-dot" style={{ background: color }} />
              <div>
                <p className="tl__card-name">{t.name}</p>
                <p className="tl__card-meta">
                  {t.playerCount} en sala · {t.openRooms} {t.openRooms === 1 ? 'partida abierta' : 'partidas abiertas'}
                  {t.activeGames > 0 && ` · ${t.activeGames} en curso`}
                </p>
              </div>
            </div>
            <div className="tl__card-right">
              {isMyTier && <span className="tl__badge">Tu nivel</span>}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          </div>
        )
      })}
      {!user && (
        <p className="tl__login-hint">Inicia sesión para ver tu nivel y poder jugar en torneos</p>
      )}
    </div>
  )
}
