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

// Pages in swipe order
const PAGES = [
  { id: 'clasificacion', label: 'Clasificación', desc: 'Consulta el ranking de jugadores' },
  { id: 'online',        label: 'Juego online',  desc: 'Únete a una partida o crea la tuya' },
  { id: 'solo',          label: 'Solo Play',      desc: 'Reta a la máquina en una partida rápida' },
]
const DEFAULT_PAGE = 'online'

// ── Sheet: crear sala (solo multijugador) ────────────────────────────────────

function CreateSheet({ playerName, closing, onClose }) {
  const [roomName, setRoomName]     = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [isPrivate, setIsPrivate]   = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  function create() {
    if (!playerName?.trim()) return setError('Introduce tu nombre primero')
    if (!roomName.trim())    return setError('Ponle un nombre a la sala')
    setLoading(true)
    socket.emit('create_room', {
      playerName: playerName.trim(),
      roomName: roomName.trim(),
      maxPlayers,
      vsBot: false,
      maxRounds: 0,
      isPrivate,
    }, (res) => {
      setLoading(false)
      if (!res?.ok) return setError(res?.error || 'Error al crear la sala')
      track('room_create', { isPrivate })
      onClose()
    })
  }

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
        <div className="bs__handle" />
        <p className="bs__label">NOMBRE DE LA SALA</p>
        <input ref={inputRef} className="bs__input" placeholder="Ej: Sala de Roi"
          value={roomName} maxLength={20}
          onChange={e => { setRoomName(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && create()} />
        <div className="bs__private-row">
          <span className="bs__label" style={{ margin: 0 }}>SALA PRIVADA</span>
          <button type="button" role="switch" aria-checked={isPrivate}
            className={`bs__toggle${isPrivate ? ' bs__toggle--on' : ''}`}
            onClick={() => setIsPrivate(v => !v)} />
        </div>
        <p className="bs__label">JUGADORES MÁXIMOS</p>
        <div className="bs__pills">
          {MAX_PLAYERS_OPTIONS.map(n => (
            <button key={n} className={`bs__pill${maxPlayers === n ? ' bs__pill--active' : ''}`}
              onClick={() => setMaxPlayers(n)}>{n}</button>
          ))}
        </div>
        {error && <p className="bs__error">{error}</p>}
        <button className="bs__submit" onClick={create} disabled={loading}>
          {loading ? 'Creando...' : 'Crear sala'}
        </button>
      </div>
    </>
  )
}

// ── Sheet: solo play (vs bots) ───────────────────────────────────────────────

function SoloSheet({ playerName, closing, onClose }) {
  const [soloPlayers, setSoloPlayers] = useState(2)
  const [error, setError]             = useState('')
  const [loading, setLoading]         = useState(false)

  function create() {
    if (!playerName?.trim()) return setError('Introduce tu nombre primero')
    setLoading(true)
    socket.emit('create_room', {
      playerName: playerName.trim(),
      roomName: 'Solo Play',
      maxPlayers: soloPlayers,
      vsBot: true,
      maxRounds: 0,
      isPrivate: false,
    }, (res) => {
      setLoading(false)
      if (!res?.ok) return setError(res?.error || 'Error al crear la partida')
      track('room_create', { vsBot: true })
      onClose()
    })
  }

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
        <div className="bs__handle" />
        <p className="bs__label">JUGADORES</p>
        <div className="bs__pills">
          {SOLO_PLAYERS_OPTIONS.map(n => (
            <button key={n} className={`bs__pill${soloPlayers === n ? ' bs__pill--active' : ''}`}
              onClick={() => setSoloPlayers(n)}>{n}</button>
          ))}
        </div>
        {error && <p className="bs__error">{error}</p>}
        <button className="bs__submit" onClick={create} disabled={loading}>
          {loading ? 'Creando...' : 'Jugar'}
        </button>
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoomList({
  user, playerName, onLogin,
  onSettingsUpdate, onSettingsLogout, onSettingsDelete,
}) {
  const [activeTab, setActiveTab]           = useState(DEFAULT_PAGE)
  const [rooms, setRooms]                   = useState([])
  const [error, setError]                   = useState('')
  const [joiningCode, setJoiningCode]       = useState(null)
  const [connected, setConnected]           = useState(socket.connected)
  const [codeModal, setCodeModal]           = useState(null)
  const [codeInput, setCodeInput]           = useState('')
  const [codeError, setCodeError]           = useState('')
  const [createSheet, setCreateSheet]       = useState(false)
  const [createClosing, setCreateClosing]   = useState(false)
  const [soloSheet, setSoloSheet]           = useState(false)
  const [soloClosing, setSoloClosing]       = useState(false)
  const [settingsOpen, setSettingsOpen]     = useState(false)
  const [settingsClosing, setSettingsClosing] = useState(false)
  const [myStats, setMyStats]   = useState(null)
  const [myRank, setMyRank]     = useState(null)
  const [rankings, setRankings] = useState([])
  const [rankTotal, setRankTotal] = useState(0)

  const pagerRef         = useRef(null)
  const scrollTimerRef   = useRef(null)
  const progScrollRef    = useRef(false)
  const closeCreateRef   = useRef(null)
  const closeSoloRef     = useRef(null)
  const closeSettingsRef = useRef(null)
  const didInitRef       = useRef(false)

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
      clearTimeout(closeCreateRef.current)
      clearTimeout(closeSoloRef.current)
      clearTimeout(closeSettingsRef.current)
      clearTimeout(scrollTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll pager to default page on mount (no animation)
  useEffect(() => {
    if (didInitRef.current) return
    const pager = pagerRef.current
    if (!pager) return
    const idx = PAGES.findIndex(p => p.id === DEFAULT_PAGE)
    requestAnimationFrame(() => {
      progScrollRef.current = true
      pager.scrollLeft = pager.offsetWidth * idx
      requestAnimationFrame(() => { progScrollRef.current = false })
    })
    didInitRef.current = true
  }, [])

  // ── Pager ↔ tab sync ─────────────────────────────────────────────────────

  function handlePagerScroll() {
    if (progScrollRef.current) return
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const pager = pagerRef.current
      if (!pager) return
      const idx = Math.round(pager.scrollLeft / pager.offsetWidth)
      const page = PAGES[Math.min(idx, PAGES.length - 1)]
      if (page && page.id !== activeTab) setActiveTab(page.id)
    }, 150)
  }

  function goToPage(id) {
    const idx = PAGES.findIndex(p => p.id === id)
    if (idx < 0) return
    const pager = pagerRef.current
    if (!pager) return
    progScrollRef.current = true
    pager.scrollTo({ left: pager.offsetWidth * idx, behavior: 'smooth' })
    setActiveTab(id)
    setTimeout(() => { progScrollRef.current = false }, 600)
  }

  // ── Sheets ────────────────────────────────────────────────────────────────

  function openCreate() {
    clearTimeout(closeCreateRef.current)
    setCreateClosing(false)
    setCreateSheet(true)
  }
  function closeCreate() {
    setCreateClosing(true)
    closeCreateRef.current = setTimeout(() => { setCreateSheet(false); setCreateClosing(false) }, CLOSE_DURATION)
  }

  function openSolo() {
    clearTimeout(closeSoloRef.current)
    setSoloClosing(false)
    setSoloSheet(true)
  }
  function closeSolo() {
    setSoloClosing(true)
    closeSoloRef.current = setTimeout(() => { setSoloSheet(false); setSoloClosing(false) }, CLOSE_DURATION)
  }

  function openSettings() {
    clearTimeout(closeSettingsRef.current)
    setSettingsClosing(false)
    setSettingsOpen(true)
  }
  function closeSettings() {
    setSettingsClosing(true)
    closeSettingsRef.current = setTimeout(() => { setSettingsOpen(false); setSettingsClosing(false) }, CLOSE_DURATION)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function handleGoogleSuccess(credentialResponse) {
    const payload = decodeJwt(credentialResponse.credential)
    if (!payload) return setError('Error al iniciar sesión con Google')
    onLogin({ name: payload.name, email: payload.email, picture: payload.picture, googleId: payload.sub })
    setError('')
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rl">

      {/* Header */}
      <header className="rl__header">
        <div className="rl__hd-user">
          <span className="rl__hd-name">{user?.name || playerName}</span>
          {myStats && <TierDot tier={myStats.tier} />}
          {!connected && <span className="rl__offline">off</span>}
        </div>
        <img className="rl__logo" src="/assets/logo-bulebule.png" alt="Bule Bule" draggable={false} />
        <div className="rl__hd-score">
          {myStats && <>
            <span className="rl__hd-pts">{myStats.score.toLocaleString()} pts</span>
            {myRank && <span className="rl__hd-rank">{myRank}/{rankTotal}</span>}
          </>}
        </div>
      </header>

      {/* Horizontal pager — each child is a full-width page */}
      <div className="rl__pager" ref={pagerRef} onScroll={handlePagerScroll}>

        {/* Page 0: Clasificación */}
        <div className="rl__page">
          <div className="rl__page-card">
            <span className="rl__page-label">Clasificación</span>
            <span className="rl__page-desc">Consulta el ranking de jugadores</span>
          </div>
          <div className="rl__page-body">
            <div className="rl__ranking-header">
              <h2 className="rl__ranking-title">Clasificación</h2>
              <button className="rl__icon-btn" aria-label="Actualizar" onClick={fetchStats}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          </div>
        </div>

        {/* Page 1: Juego online */}
        <div className="rl__page">
          <div className="rl__page-card">
            <span className="rl__page-label">Juego online</span>
            <span className="rl__page-desc">Únete a una partida o crea la tuya</span>
          </div>
          <div className="rl__page-body">
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
            <button className="rl__create-btn" onClick={openCreate} disabled={!connected}>
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
          </div>
        </div>

        {/* Page 2: Solo Play */}
        <div className="rl__page">
          <div className="rl__page-card rl__page-card--solo">
            <span className="rl__page-label">Solo Play</span>
            <span className="rl__page-desc">Reta a la máquina en una partida rápida</span>
          </div>
          <div className="rl__page-body">
            <button className="rl__create-btn" onClick={openSolo} disabled={!connected}>
              Jugar
            </button>
          </div>
        </div>

      </div>

      {/* Navbar */}
      <nav className="rl__navbar">
        <button className={`rl__nav-btn${activeTab === 'clasificacion' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('clasificacion')} aria-label="Clasificación">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6"  y1="20" x2="6"  y2="14"/>
          </svg>
        </button>

        <button className={`rl__nav-btn${activeTab === 'online' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('online')} aria-label="Juego online">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>

        <button className="rl__nav-btn" aria-label="Usuario"
          onClick={() => user ? openSettings() : goToPage('online')}>
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

      {/* Settings sheet */}
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

      {/* Create room sheet */}
      {createSheet && (
        <CreateSheet playerName={playerName} closing={createClosing} onClose={closeCreate} />
      )}

      {/* Solo play sheet */}
      {soloSheet && (
        <SoloSheet playerName={playerName} closing={soloClosing} onClose={closeSolo} />
      )}

      {/* Private room code modal */}
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
