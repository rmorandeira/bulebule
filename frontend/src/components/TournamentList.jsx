import { useState, useEffect } from 'react'
import socket from '../socket'
import { imgSrc } from '../utils/imgSrc'
import { useTranslation } from '../i18n'

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32', Especial: '#a78bfa', Abierto: '#34d399' }
const TIER_EMOJI = { Diamante: '💎', Oro: '🥇', Plata: '🥈', Bronce: '🥉', Especial: '⭐', Abierto: '🌐' }
const TIER_ORDER = ['Diamante', 'Oro', 'Plata', 'Bronce', 'Especial', 'Abierto']
const TIER_RANK  = { Diamante: 3, Oro: 2, Plata: 1, Bronce: 0, Especial: -1, Abierto: -1 }

function fmtPeriod(starts_at, ends_at, t, lang) {
  if (!starts_at && !ends_at) return null
  const fmt = ts => new Date(ts * 1000).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'short' })
  if (starts_at && ends_at) return t('tournaments.periodRange', { start: fmt(starts_at), end: fmt(ends_at) })
  if (starts_at) return t('tournaments.periodFrom', { date: fmt(starts_at) })
  return t('tournaments.periodUntil', { date: fmt(ends_at) })
}

export default function TournamentList({ user, myStats, onEnter }) {
  const { t, lang } = useTranslation()
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

  const itemTournaments = tournaments.filter(tour => tour.requiredItem)
  const itemIds = new Set(itemTournaments.map(tour => tour.id))
  const tierTournaments = TIER_ORDER.flatMap(tierName => tournaments.filter(tour => tour.tier === tierName && !itemIds.has(tour.id)))

  return (
    <div className="tl">
      <p className="tl__hint">{t('tournaments.hint')}</p>
      {tierTournaments.map(tour => {
        const tierRank   = TIER_RANK[tour.tier]
        const isMyTier   = myTier === tour.tier
        const isLower    = myRank > tierRank
        const isLocked   = user && myRank < tierRank
        const isInactive = !tour.active
        let cardClass = 'tl__card'
        if (isMyTier)   cardClass += ' tl__card--mine'
        if (isLocked)   cardClass += ' tl__card--locked'
        if (isInactive) cardClass += ' tl__card--inactive'
        return (
          <div key={tour.id} className={cardClass} onClick={() => !isLocked && onEnter(tour)}>
            <span className="tl__card-emoji">{TIER_EMOJI[tour.tier]}</span>
            <div className="tl__card-body">
              <p className="tl__card-name">{tour.name}</p>
              {fmtPeriod(tour.starts_at, tour.ends_at, t, lang) && (
                <p className="tl__card-period">{fmtPeriod(tour.starts_at, tour.ends_at, t, lang)}</p>
              )}
              <p className="tl__card-meta">
                {t('tournaments.metaTier', { count: tour.playerCount, openRooms: tour.openRooms, activeGames: tour.activeGames })}
              </p>
            </div>
            {isInactive ? (
              <span className="tl__badge tl__badge--inactive">{t('shop.unavailable')}</span>
            ) : (
              <>
                {isMyTier && <span className="tl__badge">{t('tournaments.myTier')}</span>}
                {isLower  && <span className="tl__badge tl__badge--lower">{t('tournaments.accessible')}</span>}
                {isLocked && <span className="tl__badge tl__badge--locked">🔒</span>}
              </>
            )}
          </div>
        )
      })}

      {itemTournaments.length > 0 && (
        <>
          <p className="tl__hint tl__hint--section">{t('tournaments.exclusiveSection')}</p>
          {itemTournaments.map(tour => {
            const hasItem    = userItems.includes(tour.requiredItem)
            const isLocked   = user && !hasItem
            const isInactive = !tour.active
            let cardClass = 'tl__card tl__card--exclusive'
            if (isLocked)   cardClass += ' tl__card--locked'
            if (isInactive) cardClass += ' tl__card--inactive'
            return (
              <div key={tour.id} className={cardClass} onClick={() => !isLocked && onEnter(tour)}>
                {tour.requiredItemImageUrl
                  ? <img className="tl__card-item-img" src={imgSrc(tour.requiredItemImageUrl)} alt={tour.requiredItemName ?? ''} />
                  : <span className="tl__card-emoji">🔑</span>
                }
                <div className="tl__card-body">
                  <p className="tl__card-name">{tour.name}</p>
                  <p className="tl__card-req">
                    {t('tournaments.requires')} <strong>{tour.requiredItemName ?? tour.requiredItem}</strong>
                  </p>
                  {fmtPeriod(tour.starts_at, tour.ends_at, t, lang) && (
                    <p className="tl__card-period">{fmtPeriod(tour.starts_at, tour.ends_at, t, lang)}</p>
                  )}
                  <p className="tl__card-meta">
                    {t('tournaments.metaExclusive', { count: tour.playerCount, openRooms: tour.openRooms, activeGames: tour.activeGames })}
                  </p>
                </div>
                {isInactive ? (
                  <span className="tl__badge tl__badge--inactive">{t('shop.unavailable')}</span>
                ) : (
                  <>
                    {hasItem  && <span className="tl__badge tl__badge--key">{t('tournaments.youHaveAccess')}</span>}
                    {isLocked && <span className="tl__badge tl__badge--locked">🔒</span>}
                  </>
                )}
              </div>
            )
          })}
        </>
      )}

      {!user && (
        <p className="tl__login-hint">{t('tournaments.loginHint')}</p>
      )}
    </div>
  )
}
