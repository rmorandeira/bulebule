import { useState, useEffect, useRef } from 'react'
import socket from '../socket'
import { imgSrc } from '../utils/imgSrc'
import { useSheetDrag } from '../hooks/useSheetDrag'

const CLOSE_DURATION = 260

function getFavorites() {
  try { return JSON.parse(localStorage.getItem('bule_favorites') ?? '{}') } catch { return {} }
}
function saveFavorites(favs) {
  localStorage.setItem('bule_favorites', JSON.stringify(favs))
}
const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }

const HAND_RANK_LABEL = ['Carta alta', 'Pareja', 'Dobles parejas', 'Trío', 'Escalera', 'Full', 'Póker', 'Repóker']

function getPlayerType(handStats, rollStats) {
  if (!handStats?.length) return null
  const totalRounds = rollStats?.reduce((s, r) => s + r.count, 0) ?? 0
  if (totalRounds < 3) return null
  const totalRolls  = rollStats?.reduce((s, r) => s + r.rolls * r.count, 0) ?? 0
  const avgRolls    = totalRolls / totalRounds
  const totalHands  = handStats.reduce((s, h) => s + h.count, 0)
  const repókerCount = handStats.find(h => h.hand_rank === 7)?.count ?? 0
  const highCount   = handStats.filter(h => h.hand_rank >= 5).reduce((s, h) => s + h.count, 0)
  const highPct     = totalHands > 0 ? highCount / totalHands : 0

  if (repókerCount >= 2)  return 'Repoquero'
  if (highPct > 0.25)     return 'Jugador técnico'
  if (avgRolls >= 2.6)    return 'Jugador arriesgado'
  if (avgRolls <= 1.4)    return 'Jugador cauteloso'
  return 'Jugador equilibrado'
}

export default function UserDetailSheet({ userId, initialName, initialPicture, onClose, user, playerName, hideChallenge = false }) {
  const { sheetRef, handleProps } = useSheetDrag(() => close())
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [closing, setClosing]   = useState(false)
  const [challenging, setChallenging] = useState(false)
  const [error, setError]       = useState('')
  const [isFavorite, setIsFavorite] = useState(() => !!getFavorites()[userId])
  const [selectedItem, setSelectedItem]   = useState(null)
  const [itemClosing, setItemClosing]     = useState(false)
  const [activeSkin, setActiveSkin]       = useState(() => localStorage.getItem('bule_dice_skin') ?? null)
  const closeRef = useRef(null)
  const itemCloseRef = useRef(null)

  useEffect(() => {
    if (!userId) return
    setProfile(null)
    setLoading(true)
    setError('')
    setClosing(false)
    setSelectedItem(null)
    setItemClosing(false)
    socket.emit('get_user_profile', { userId }, (res) => {
      setLoading(false)
      if (res?.ok) setProfile(res)
      else setError(res?.error ?? 'No se pudo cargar el perfil')
    })
  }, [userId])

  function close() {
    setClosing(true)
    clearTimeout(closeRef.current)
    closeRef.current = setTimeout(() => { setClosing(false); onClose() }, CLOSE_DURATION)
  }

  function toggleFavorite() {
    const favs = getFavorites()
    if (isFavorite) {
      delete favs[userId]
      setIsFavorite(false)
    } else {
      favs[userId] = { name, picture }
      setIsFavorite(true)
    }
    saveFavorites(favs)
  }

  function openItem(item) {
    clearTimeout(itemCloseRef.current)
    setItemClosing(false)
    setSelectedItem(item)
  }

  function closeItem() {
    setItemClosing(true)
    itemCloseRef.current = setTimeout(() => { setSelectedItem(null); setItemClosing(false) }, CLOSE_DURATION)
  }

  function handleEquip(itemId) {
    localStorage.setItem('bule_dice_skin', itemId)
    setActiveSkin(itemId)
    socket.emit('set_dice_skin', { skinId: itemId })
  }

  function handleUnequip() {
    localStorage.removeItem('bule_dice_skin')
    setActiveSkin(null)
    socket.emit('set_dice_skin', { skinId: null })
  }

  function handleChallenge() {
    if (challenging) return
    setChallenging(true)
    setError('')
    const myName = user?.name ?? playerName ?? 'Jugador'
    socket.emit('challenge_user', { toUserId: userId, playerName: myName }, (res) => {
      setChallenging(false)
      if (!res?.ok) return setError(res?.error ?? 'Error al crear el reto')
      const url = `${window.location.origin}/?join=${res.code}`
      const text = `¡${myName} te reta al Bule Bule! ⚔️🎲\nÚnete aquí: ${url}`
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
      close()
    })
  }

  const name      = profile?.name      ?? initialName    ?? '...'
  const picture   = profile?.picture   ?? initialPicture ?? null
  const stats     = profile?.stats
  const items     = profile?.items     ?? []
  const handStats = profile?.handStats ?? []
  const rollStats = profile?.rollStats ?? []
  const isSelf    = user?.email === userId
  const canChallenge = !!user && !isSelf

  const playerType  = getPlayerType(handStats, rollStats)
  const topHands    = [...handStats].sort((a, b) => b.count - a.count).slice(0, 5)
  const totalRounds = rollStats.reduce((s, r) => s + r.count, 0)
  const avgRolls    = totalRounds > 0
    ? (rollStats.reduce((s, r) => s + r.rolls * r.count, 0) / totalRounds).toFixed(1)
    : null

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={close} />
      <div className={`bs uds${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="uds__handle-sticky"><div className="bs__handle" {...handleProps} /></div>

        {/* Header */}
        <div className="uds__header">
          {picture ? (
            <img src={picture} alt={name} referrerPolicy="no-referrer" className="uds__avatar" />
          ) : (
            <div className="uds__avatar uds__avatar--placeholder">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
          )}
          <div className="uds__header-info">
            <div className="uds__name-row">
              <p className="uds__name">{name}</p>
              {!isSelf && (
                <button
                  className={`uds__fav-btn${isFavorite ? ' uds__fav-btn--active' : ''}`}
                  onClick={toggleFavorite}
                  aria-label={isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}
                >
                  {isFavorite ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                  )}
                </button>
              )}
            </div>
            <div className="uds__header-badges">
              {stats && (
                <span className="uds__tier-badge" style={{ background: TIER_COLOR[stats.tier] ?? TIER_COLOR.Bronce }}>
                  {stats.tier}
                </span>
              )}
              {playerType && (
                <span className="uds__type-badge">{playerType}</span>
              )}
            </div>
          </div>
        </div>

        {loading && <p className="uds__loading">Cargando...</p>}

        {!loading && stats && (
          <div className="uds__stats">
            <div className="uds__stat">
              <span className="uds__stat-val">{stats.score.toLocaleString()}</span>
              <span className="uds__stat-lbl">Bules</span>
            </div>
            <div className="uds__stat">
              <span className="uds__stat-val">{stats.gamesPlayed}</span>
              <span className="uds__stat-lbl">Partidas</span>
            </div>
            <div className="uds__stat">
              <span className="uds__stat-val">
                {stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0}%
              </span>
              <span className="uds__stat-lbl">Victorias</span>
            </div>
            {avgRolls && (
              <div className="uds__stat">
                <span className="uds__stat-val">{avgRolls}</span>
                <span className="uds__stat-lbl">Tiradas/ronda</span>
              </div>
            )}
          </div>
        )}

        {!loading && topHands.length > 0 && (
          <>
            <p className="uds__section-title">JUGADAS</p>
            <div className="uds__hands">
              {topHands.map(h => (
                <div key={h.hand_desc} className="uds__hand-row">
                  <span className="uds__hand-rank" style={{ opacity: 0.4 + (h.hand_rank / 7) * 0.6 }}>
                    {HAND_RANK_LABEL[h.hand_rank] ?? h.hand_rank}
                  </span>
                  <span className="uds__hand-desc">{h.hand_desc}</span>
                  <span className="uds__hand-count">×{h.count}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && items.length > 0 && (
          <>
            <p className="uds__section-title">ITEMS</p>
            <div className="uds__items">
              {items.map(item => (
                <div key={item.id} className="uds__item" onClick={() => openItem(item)} style={{ cursor: 'pointer' }}>
                  <img src={imgSrc(item.image_url)} alt={item.name} className="uds__item-img"
                    onError={e => { e.currentTarget.style.display = 'none' }} />
                  <p className="uds__item-name">{item.name}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p className="bs__error">{error}</p>}

        {!hideChallenge && (canChallenge ? (
          <button className="bs__submit" onClick={handleChallenge} disabled={challenging}>
            {challenging ? 'Creando reto...' : `⚔️ Retar a ${name}`}
          </button>
        ) : !user ? (
          <p className="uds__hint">Inicia sesión para retar a este jugador</p>
        ) : isSelf ? (
          <p className="uds__hint">Este es tu perfil</p>
        ) : null)}
      </div>

      {selectedItem && (
        <>
          <div
            className={`bs-overlay bs-overlay--layer2${itemClosing ? ' bs-overlay--closing' : ''}`}
            onClick={closeItem}
          />
          <div className={`bs bs--layer2${itemClosing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
            <div className="bs__handle" />
            <div className="mkt__sheet">
              <div className="mkt__sheet-img-wrap">
                <img
                  className="mkt__sheet-img"
                  src={imgSrc(selectedItem.image_url)}
                  alt={selectedItem.name}
                  onError={e => { e.currentTarget.style.display = 'none' }}
                />
              </div>
              <p className="mkt__sheet-name">{selectedItem.name}</p>
              {selectedItem.description && (
                <p className="mkt__sheet-desc" dangerouslySetInnerHTML={{ __html: selectedItem.description }} />
              )}
              <p className="mkt__sheet-price">
                {selectedItem.price === 0 ? 'Gratis' : `${selectedItem.price.toLocaleString()} Bules`}
              </p>
              {isSelf && selectedItem.category === 'dice' && (
                activeSkin === selectedItem.id ? (
                  <button className="bs__submit bs__submit--secondary" onClick={handleUnequip}>
                    Desactivar skin
                  </button>
                ) : (
                  <button className="bs__submit" onClick={() => handleEquip(selectedItem.id)}>
                    Activar skin
                  </button>
                )
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}
