import { useState, useEffect } from 'react'
import socket from '../socket'

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }
const TIER_EMOJI = { Diamante: '💎', Oro: '🥇', Plata: '🥈', Bronce: '🥉' }
const TIER_ORDER = ['Diamante', 'Oro', 'Plata', 'Bronce']
const TIER_RANK  = { Diamante: 3, Oro: 2, Plata: 1, Bronce: 0 }

export default function TournamentList({ user, myStats, onEnter }) {
  const [tournaments, setTournaments] = useState([])
  const [userItems, setUserItems]     = useState([])

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

  useEffect(() => {
    if (!user) { setUserItems([]); return }
    socket.emit('get_user_items', (res) => {
      if (res?.ok) setUserItems(res.items?.map(i => i.id) ?? [])
    })
  }, [user])

  const myTier = myStats?.tier
  const myRank = TIER_RANK[myTier] ?? -1

  const tierTournaments = TIER_ORDER.map(tierName => tournaments.find(t => t.tier === tierName)).filter(Boolean)
  const itemTournaments = tournaments.filter(t => t.requiredItem)

  return (
    <div className="tl">
      <p className="tl__hint">Entra en el torneo de tu nivel y reta a otros jugadores</p>
      {tierTournaments.map(t => {
        const tierRank = TIER_RANK[t.tier]
        const isMyTier = myTier === t.tier
        const isLower  = myRank > tierRank
        const isLocked = user && myRank < tierRank
        let cardClass = 'tl__card'
        if (isMyTier)  cardClass += ' tl__card--mine'
        if (isLocked)  cardClass += ' tl__card--locked'
        return (
          <div key={t.id} className={cardClass} onClick={() => !isLocked && onEnter(t)}>
            <span className="tl__card-emoji">{TIER_EMOJI[t.tier]}</span>
            <div className="tl__card-body">
              <p className="tl__card-name">{t.name}</p>
              <p className="tl__card-meta">
                {t.playerCount} en sala. {t.openRooms} {t.openRooms === 1 ? 'Partida abierta' : 'Partidas abiertas'}
                {t.activeGames > 0 && ` · ${t.activeGames} en curso`}
              </p>
            </div>
            {isMyTier && <span className="tl__badge">Tu nivel</span>}
            {isLower  && <span className="tl__badge tl__badge--lower">Accesible</span>}
            {isLocked && <span className="tl__badge tl__badge--locked">🔒</span>}
          </div>
        )
      })}

      {itemTournaments.length > 0 && (
        <>
          <p className="tl__hint tl__hint--section">Torneos exclusivos</p>
          {itemTournaments.map(t => {
            const hasItem  = userItems.includes(t.requiredItem)
            const isLocked = user && !hasItem
            let cardClass = 'tl__card tl__card--exclusive'
            if (isLocked) cardClass += ' tl__card--locked'
            return (
              <div key={t.id} className={cardClass} onClick={() => !isLocked && onEnter(t)}>
                {t.requiredItemImageUrl
                  ? <img className="tl__card-item-img" src={t.requiredItemImageUrl} alt={t.requiredItemName ?? ''} />
                  : <span className="tl__card-emoji">🔑</span>
                }
                <div className="tl__card-body">
                  <p className="tl__card-name">{t.name}</p>
                  <p className="tl__card-req">
                    Requiere: <strong>{t.requiredItemName ?? t.requiredItem}</strong>
                  </p>
                  <p className="tl__card-meta">
                    {t.playerCount} en sala · {t.openRooms} {t.openRooms === 1 ? 'partida abierta' : 'partidas abiertas'}
                    {t.activeGames > 0 && ` · ${t.activeGames} en curso`}
                  </p>
                </div>
                {hasItem  && <span className="tl__badge tl__badge--key">Tienes acceso</span>}
                {isLocked && <span className="tl__badge tl__badge--locked">🔒</span>}
              </div>
            )
          })}
        </>
      )}

      {!user && (
        <p className="tl__login-hint">Inicia sesión para ver tu nivel y poder jugar en torneos</p>
      )}
    </div>
  )
}
