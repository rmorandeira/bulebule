import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

const CLOSE_DURATION = 260
const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }

export default function UserDetailSheet({ userId, initialName, initialPicture, onClose, user, playerName }) {
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [closing, setClosing]   = useState(false)
  const [challenging, setChallenging] = useState(false)
  const [error, setError]       = useState('')
  const closeRef = useRef(null)

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    setError('')
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

  const name    = profile?.name    ?? initialName    ?? '...'
  const picture = profile?.picture ?? initialPicture ?? null
  const stats   = profile?.stats
  const items   = profile?.items ?? []
  const isSelf  = user?.email === userId
  const canChallenge = !!user && !isSelf

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={close} />
      <div className={`bs uds${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
        <div className="bs__handle" />

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
            <p className="uds__name">{name}</p>
            {stats && (
              <span className="uds__tier-badge" style={{ background: TIER_COLOR[stats.tier] ?? TIER_COLOR.Bronce }}>
                {stats.tier}
              </span>
            )}
          </div>
        </div>

        {loading && <p className="uds__loading">Cargando...</p>}

        {!loading && stats && (
          <div className="uds__stats">
            <div className="uds__stat">
              <span className="uds__stat-val">{stats.score.toLocaleString()}</span>
              <span className="uds__stat-lbl">Puntos</span>
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
          </div>
        )}

        {!loading && items.length > 0 && (
          <>
            <p className="uds__section-title">ITEMS</p>
            <div className="uds__items">
              {items.map(item => (
                <div key={item.id} className="uds__item">
                  <img src={item.image_url} alt={item.name} className="uds__item-img"
                    onError={e => { e.currentTarget.style.display = 'none' }} />
                  <p className="uds__item-name">{item.name}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p className="bs__error">{error}</p>}

        {canChallenge ? (
          <button className="bs__submit" onClick={handleChallenge} disabled={challenging}>
            {challenging ? 'Creando reto...' : `⚔️ Retar a ${name}`}
          </button>
        ) : !user ? (
          <p className="uds__hint">Inicia sesión para retar a este jugador</p>
        ) : null}
      </div>
    </>
  )
}
