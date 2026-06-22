import { useState, useEffect, useRef } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import socket from '../socket'
import { track } from '../analytics'
import UserSettings from './UserSettings'

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }

function TierDot({ tier }) {
  return <span className="tier-dot" style={{ background: TIER_COLOR[tier] ?? TIER_COLOR.Bronce }} />
}

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8]
const SOLO_PLAYERS_OPTIONS = [2, 3, 4, 5]
const CLOSE_DURATION = 260

const CARDS = [
  { id: 'clasificacion', label: 'Clasificación',  desc: 'Consulta el ranking de jugadores' },
  { id: 'online',        label: 'Juego online',   desc: 'Únete a una partida o crea la tuya' },
  { id: 'solo',          label: 'Solo Play',       desc: 'Reta a la máquina en una partida rápida' },
]

// ── Bottom sheet (crear sala) ─────────────────────────────────────────────────

function CreateSheet({ playerName, user, initialVsBot, closing, onClose }) {
  const [vsBot, setVsBot] = useState(initialVsBot ?? false)
  const [roomName, setRoomName] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [soloPlayers, setSoloPlayers] = useState(2)
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!vsBot && window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [vsBot])

  function create() {
    if (!playerName?.trim()) return setError('Introduce tu nombre primero')
    if (!vsBot && !roomName.trim()) return setError('Ponle un nombre a la sala')
    setLoading(true)
    socket.emit('create_room', {
      playerName: playerName.trim(),
      roomName: vsBot ? 'Solo Play' : roomName.trim(),
      maxPlayers: vsBot ? soloPlayers : maxPlayers,
      vsBot,
      maxRounds: 0,
      isPrivate: !vsBot && isPrivate,
    }, (res) => {
      setLoading(false)
      if (!res?.ok) return setError(res?.error || 'Error al crear la sala')
      track('room_create', { vsBot, isPrivate: !vsBot && isPrivate })
      onClose()
    })
  }

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
        <div className="bs__handle" />
        <p className="bs__label">MODO DE JUEGO</p>
        <div className="bs__mode-row">
          <button className={`bs__mode-btn${!vsBot ? ' bs__mode-btn--active' : ''}`} onClick={() => { setVsBot(false); setError('') }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Multijugador
          </button>
          <button className={`bs__mode-btn${vsBot ? ' bs__mode-btn--active' : ''}`} onClick={() => { setVsBot(true); setError('') }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Vs máquina
          </button>
        </div>
        <div className={`bs__collapse${!vsBot ? ' bs__collapse--open' : ''}`}>
          <div className="bs__collapse-inner">
            <p className="bs__label">NOMBRE DE LA SALA</p>
            <input ref={inputRef} className="bs__input" placeholder="Ej: Sala de Roi" value={roomName} maxLength={20}
              onChange={e => { setRoomName(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && create()} />
            <div className="bs__private-row">
              <span className="bs__label" style={{ margin: 0 }}>SALA PRIVADA</span>
              <button type="button" role="switch" aria-checked={isPrivate}
                className={`bs__toggle${isPrivate ? ' bs__toggle--on' : ''}`}
                onClick={() => setIsPrivate(v => !v)} />
            </div>
          </div>
        </div>
        <p className="bs__label">JUGADORES {vsBot ? '' : 'MÁXIMOS'}</p>
        <div className="bs__pills">
          {(vsBot ? SOLO_PLAYERS_OPTIONS : MAX_PLAYERS_OPTIONS).map(n => (
            <button key={n}
              className={`bs__pill${(vsBot ? soloPlayers : maxPlayers) === n ? ' bs__pill--active' : ''}`}
              onClick={() => vsBot ? setSoloPlayers(n) : setMaxPlayers(n)}>{n}</button>
          ))}
        </div>
        {error && <p className="bs__error">{error}</p>}
        <button className="bs__submit" onClick={create} disabled={loading}>
          {loading ? 'Creando...' : vsBot ? 'Jugar' : 'Crear sala'}
        </button>
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoomList({
  user, playerName, onLogin,
  onSettingsUpdate, onSettingsLogout, onSettingsDelete,
  musicOn, onToggleMusic,
}) {
  const [activeTab, setActiveTab]       = useState('online')
  const [rooms, setRooms]               = useState([])
  const [error, setError]               = useState('')
  const [joiningCode, setJoiningCode]   = useState(null)
  const [connected, setConnected]       = useState(socket.connected)
  const [codeModal, setCodeModal]       = useState(null)
  const [codeInput, setCodeInput]       = useState('')
  const [codeError, setCodeError]       = useState('')
  const [sheetState, setSheetState]     = useState(null)
  const [sheetClosing, setSheetClosing] = useState(false)
  const [settingsOpen, setSettingsOpen]       = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [myStats, setMyStats]   = useState(null)
  const [myRank, setMyRank]     = useState(null)
  const [rankings, setRankings] = useState([])
  const [rankTotal, setRankTotal] = useState(0)

  const closeTimerRef    = useRef(null)
  const settingsTimerRef = useRef(null)
  const carouselRef      = useRef(null)
  const scrollTimerRef   = useRef(null)
  const progScrollRef    = useRef(false)   // true while JS-driven scroll is in flight

  function fetchStats() {
    socket.emit('get_stats', (res) => {
      if (!res?.ok) return
      setMyStats(res.stats)
      setMyRank(res.myRank)
      setRankings(res.rankings ?? [])
      setRankTotal(res.total ?? 0)
    })
  }

  useEffect(() => {
    function onConnect() {
      setConnected(true)
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
      fetchStats()
    }
    function onDisconnect() { setConnected(false) }
    function onRoomsList(list) { setRooms(list) }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('rooms_list', onRoomsList)
    if (socket.connected) {
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
      fetchStats()
    }
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('rooms_list', onRoomsList)
      clearTimeout(closeTimerRef.current)
      clearTimeout(settingsTimerRef.current)
      clearTimeout(scrollTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Carousel ↔ tab sync ──────────────────────────────────────────────────

  // When activeTab changes via navbar → scroll carousel
  useEffect(() => {
    const carousel = carouselRef.current
    if (!carousel) return
    const idx = CARDS.findIndex(c => c.id === activeTab)
    if (idx < 0) return
    const card = carousel.children[idx]
    if (!card) return
    progScrollRef.current = true
    carousel.scrollTo({ left: card.offsetLeft - 16, behavior: 'smooth' })
    setTimeout(() => { progScrollRef.current = false }, 600)
  }, [activeTab])

  // When carousel is dragged → update activeTab
  function handleCarouselScroll() {
    if (progScrollRef.current) return
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const carousel = carouselRef.current
      if (!carousel) return
      const center = carousel.scrollLeft + carousel.clientWidth / 2
      let bestIdx = 0, bestDist = Infinity
      Array.from(carousel.children).forEach((card, i) => {
        const d = Math.abs((card.offsetLeft + card.clientWidth / 2) - center)
        if (d < bestDist) { bestDist = d; bestIdx = i }
      })
      const card = CARDS[bestIdx]
      if (card?.id === 'solo') {
        openSheet(true)
        // drift back to online
        setTimeout(() => setActiveTab('online'), 50)
      } else if (card) {
        setActiveTab(card.id)
      }
    }, 180)
  }

  // ── Sheets ───────────────────────────────────────────────────────────────

  function openSheet(vsBot = false) {
    clearTimeout(closeTimerRef.current)
    setSheetClosing(false)
    setSheetState({ vsBot })
  }
  function closeSheet() {
    setSheetClosing(true)
    closeTimerRef.current = setTimeout(() => { setSheetState(null); setSheetClosing(false) }, CLOSE_DURATION)
  }

  function openSettings() {
    clearTimeout(settingsTimerRef.current)
    setSettingsClosing(false)
    setSettingsOpen(true)
  }
  function closeSettings() {
    setSettingsClosing(true)
    settingsTimerRef.current = setTimeout(() => { setSettingsOpen(false); setSettingsClosing(false) }, CLOSE_DURATION)
  }

  // ── Auth ─────────────────────────────────────────────────────────────────

  function handleGoogleSuccess(credentialResponse) {
    const payload = decodeJwt(credentialResponse.credential)
    if (!payload) return setError('Error al iniciar sesión con Google')
    onLogin({ name: payload.name, email: payload.email, picture: payload.picture, googleId: payload.sub })
    setError('')
  }

  // ── Rooms ────────────────────────────────────────────────────────────────

  function join(code) {
    if (!connected) return setError('Sin conexión al servidor')
    if (!playerName?.trim()) return setError('Introduce tu nombre primero')
    setJoiningCode(code)
    socket.emit('join_room', { code, playerName: playerName.trim() }, (res) => {
      setJoiningCode(null)
      if (!res?.ok) return setError(res?.error || 'No se pudo unir a la sala')
      track('room_join')
    })
  }

  function handleJoinClick(room) {
    if (room.isPrivate) { setCodeModal(room); setCodeInput(''); setCodeError('') }
    else join(room.code)
  }

  function joinByCode() {
    const entered = codeInput.trim().toUpperCase()
    if (entered !== codeModal.code) { setCodeError('Código incorrecto'); return }
    setCodeModal(null)
    join(codeModal.code)
  }

  const isFull = r => r.playerCount >= r.maxPlayers

  const initials = user
    ? user.name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : ''

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="rl">

      {/* ── Header ── */}
      <header className="rl__header">
        <div className="rl__hd-user">
          <span className="rl__hd-name">{user?.name || playerName}</span>
          {myStats && <TierDot tier={myStats.tier} />}
          {!connected && <span className="rl__offline">off</span>}
        </div>

        <img className="rl__logo" src="/assets/logo-bulebule.png" alt="Bule Bule" draggable={false} />

        <div className="rl__hd-score">
          {myStats ? (
            <>
              <span className="rl__hd-pts">{myStats.score.toLocaleString()} pts</span>
              {myRank && <span className="rl__hd-rank">{myRank}/{rankTotal}</span>}
            </>
          ) : null}
        </div>
      </header>

      {/* ── Carousel ── */}
      <div className="rl__carousel" ref={carouselRef} onScroll={handleCarouselScroll}>
        {CARDS.map(card => (
          <div
            key={card.id}
            className={`rl__slide${activeTab === card.id ? ' rl__slide--active' : ''}`}
            onClick={() => card.id === 'solo' ? openSheet(true) : setActiveTab(card.id)}
          >
            <span className="rl__slide-label">{card.label}</span>
            <span className="rl__slide-desc">{card.desc}</span>
          </div>
        ))}
      </div>

      {/* ── Content ── */}
      <main className="rl__main">

        {activeTab === 'online' && (
          <>
            {error && <p className="rl__error">{error}</p>}

            {!user && (
              <div className="rl__login-row">
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError('Error al iniciar sesión con Google')}
                  shape="pill" size="medium" text="signin_with" locale="es"
                />
              </div>
            )}

            <button className="rl__create-btn" onClick={() => openSheet(false)} disabled={!connected}>
              Crear sala
            </button>

            <div className="rl__rooms">
              {rooms.length === 0 ? (
                <p className="rl__empty">No hay partidas abiertas ahora mismo</p>
              ) : rooms.map(room => {
                const canJoin = room.phase === 'lobby' && !isFull(room)
                return (
                  <div key={room.code} className="rl__room">
                    <div className="rl__room-info">
                      <span className="rl__room-name">
                        {room.name}
                        {room.isPrivate && (
                          <svg className="rl__lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                        )}
                      </span>
                      <span className="rl__room-meta">
                        {room.playerCount} / {room.maxPlayers} Jugadores
                        {!canJoin && <span className="rl__room-status">{isFull(room) ? ' · Llena' : ' · En curso'}</span>}
                      </span>
                    </div>
                    <button className="rl__join-btn"
                      onClick={() => handleJoinClick(room)}
                      disabled={!canJoin || joiningCode !== null || !connected}>
                      {joiningCode === room.code ? '...' : 'Unirse'}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {activeTab === 'clasificacion' && (
          <>
            <div className="rl__ranking-header">
              <h2 className="rl__ranking-title">Clasificación</h2>
              <button className="rl__icon-btn" aria-label="Actualizar" onClick={fetchStats}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
              </button>
            </div>

            {rankings.length === 0 ? (
              <p className="rl__empty">Juega partidas para aparecer en la clasificación</p>
            ) : rankings.map(r => (
              <div key={r.userId} className={`rl__rank-row${r.userId === user?.email ? ' rl__rank-row--me' : ''}`}>
                <span className="rl__rank-pos">{r.rank}</span>
                <span className="rl__rank-name">{r.name}<TierDot tier={r.tier} /></span>
                <span className="rl__rank-score">{r.score.toLocaleString()}</span>
              </div>
            ))}
          </>
        )}

      </main>

      {/* ── Navbar ── */}
      <nav className="rl__navbar">
        <button
          className={`rl__nav-btn${activeTab === 'clasificacion' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => setActiveTab('clasificacion')} aria-label="Clasificación">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
        </button>

        <button
          className={`rl__nav-btn${activeTab === 'online' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => setActiveTab('online')} aria-label="Inicio">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>

        <button
          className="rl__nav-btn"
          onClick={() => user ? openSettings() : setActiveTab('online')}
          aria-label="Usuario">
          {user?.picture ? (
            <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" className="rl__nav-avatar" />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          )}
        </button>
      </nav>

      {/* ── User settings sheet ── */}
      {settingsOpen && (
        <>
          <div className={`bs-overlay${settingsClosing ? ' bs-overlay--closing' : ''}`} onClick={closeSettings} />
          <div className={`rl__settings-sheet${settingsClosing ? ' rl__settings-sheet--closing' : ''}`} role="dialog" aria-modal="true">
            <div className="bs__handle" />
            <UserSettings
              user={user}
              onBack={closeSettings}
              onUpdate={onSettingsUpdate}
              onLogout={() => { closeSettings(); onSettingsLogout() }}
              onDeleteAccount={() => { closeSettings(); onSettingsDelete() }}
            />
          </div>
        </>
      )}

      {/* ── Create room sheet ── */}
      {sheetState && (
        <CreateSheet
          playerName={playerName}
          user={user}
          initialVsBot={sheetState.vsBot}
          closing={sheetClosing}
          onClose={closeSheet}
        />
      )}

      {/* ── Private room code modal ── */}
      {codeModal && (
        <div className="modal-overlay" onClick={() => setCodeModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="modal-box__title">Sala privada</h3>
            <p className="modal-box__hint">Introduce el código para unirte a <strong>{codeModal.name}</strong></p>
            <input className="input input--code" maxLength={4} autoFocus value={codeInput}
              onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError('') }}
              onKeyDown={e => e.key === 'Enter' && joinByCode()} placeholder="XXXX" />
            {codeError && <p className="error">{codeError}</p>}
            <div className="modal-box__actions">
              <button className="btn btn--secondary" onClick={() => setCodeModal(null)}>Cancelar</button>
              <button className="btn btn--primary" onClick={joinByCode} disabled={codeInput.trim().length !== 4}>Unirse</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
