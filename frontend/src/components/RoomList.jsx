import { useState, useEffect, useRef } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import socket from '../socket'
import { track } from '../analytics'

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

// ── Bottom sheet ──────────────────────────────────────────────────────────────

function CreateSheet({ playerName, user, initialVsBot, closing, onClose }) {
  const [vsBot, setVsBot] = useState(initialVsBot ?? false)
  const [roomName, setRoomName] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [soloPlayers, setSoloPlayers] = useState(2)
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  // Focus the room name input only on desktop (avoid opening mobile keyboard on open)
  useEffect(() => {
    if (!vsBot && window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus()
    }
  }, [vsBot])

  function create() {
    if (!playerName?.trim()) return setError('Introduce tu nombre primero')
    if (!vsBot && !roomName.trim()) return setError('Ponle un nombre a la sala')
    setLoading(true)
    const name = vsBot ? 'Solo Play' : roomName.trim()
    socket.emit('create_room', {
      playerName: playerName.trim(),
      roomName: name,
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
      <div
        className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`}
        onClick={onClose}
      />
      <div
        className={`bs${closing ? ' bs--closing' : ''}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="bs__handle" />

        <p className="bs__label">MODO DE JUEGO</p>
        <div className="bs__mode-row">
          <button
            className={`bs__mode-btn${!vsBot ? ' bs__mode-btn--active' : ''}`}
            onClick={() => { setVsBot(false); setError('') }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Multijugador
          </button>
          <button
            className={`bs__mode-btn${vsBot ? ' bs__mode-btn--active' : ''}`}
            onClick={() => { setVsBot(true); setError('') }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Vs máquina
          </button>
        </div>

        {/* Collapsible multijugador fields — animated with grid-template-rows */}
        <div className={`bs__collapse${!vsBot ? ' bs__collapse--open' : ''}`}>
          <div className="bs__collapse-inner">
            <p className="bs__label">NOMBRE DE LA SALA</p>
            <input
              ref={inputRef}
              className="bs__input"
              placeholder="Ej: Sala de Roi"
              value={roomName}
              maxLength={20}
              onChange={e => { setRoomName(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && create()}
            />
            <div className="bs__private-row">
              <span className="bs__label" style={{ margin: 0 }}>SALA PRIVADA</span>
              <button
                type="button"
                role="switch"
                aria-checked={isPrivate}
                className={`bs__toggle${isPrivate ? ' bs__toggle--on' : ''}`}
                onClick={() => setIsPrivate(v => !v)}
              />
            </div>
          </div>
        </div>

        <p className="bs__label">JUGADORES {vsBot ? '' : 'MÁXIMOS'}</p>
        <div className="bs__pills">
          {(vsBot ? SOLO_PLAYERS_OPTIONS : MAX_PLAYERS_OPTIONS).map(n => (
            <button
              key={n}
              className={`bs__pill${(vsBot ? soloPlayers : maxPlayers) === n ? ' bs__pill--active' : ''}`}
              onClick={() => vsBot ? setSoloPlayers(n) : setMaxPlayers(n)}
            >
              {n}
            </button>
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

export default function RoomList({ user, playerName, onNameChange, onLogin, onSettings, onCreateClick, musicOn, onToggleMusic }) {
  const [rooms, setRooms] = useState([])
  const [error, setError] = useState('')
  const [joiningCode, setJoiningCode] = useState(null)
  const [connected, setConnected] = useState(socket.connected)
  const [codeModal, setCodeModal] = useState(null)
  const [codeInput, setCodeInput] = useState('')
  const [codeError, setCodeError] = useState('')
  const [sheetState, setSheetState] = useState(null)  // null | { vsBot: bool }
  const [sheetClosing, setSheetClosing] = useState(false)
  const closeTimerRef = useRef(null)
  const [myStats, setMyStats] = useState(null)    // { score, tier, gamesPlayed, ... }
  const [myRank, setMyRank] = useState(null)
  const [rankings, setRankings] = useState([])
  const [rankTotal, setRankTotal] = useState(0)

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
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openSheet(vsBot = false) {
    clearTimeout(closeTimerRef.current)
    setSheetClosing(false)
    setSheetState({ vsBot })
  }

  function closeSheet() {
    setSheetClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setSheetState(null)
      setSheetClosing(false)
    }, CLOSE_DURATION)
  }

  function handleGoogleSuccess(credentialResponse) {
    const payload = decodeJwt(credentialResponse.credential)
    if (!payload) return setError('Error al iniciar sesión con Google')
    onLogin({ name: payload.name, email: payload.email, picture: payload.picture, googleId: payload.sub })
    setError('')
  }

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
    if (room.isPrivate) {
      setCodeModal(room)
      setCodeInput('')
      setCodeError('')
    } else {
      join(room.code)
    }
  }

  function joinByCode() {
    const entered = codeInput.trim().toUpperCase()
    if (entered !== codeModal.code) { setCodeError('Código incorrecto'); return }
    setCodeModal(null)
    join(codeModal.code)
  }

  const isFull = r => r.playerCount >= r.maxPlayers
  const initials = user ? user.name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() : ''

  return (
    <div className="rl">

      {/* Header */}
      <div className="rl__header">
        <button className="rl__icon-btn" onClick={onToggleMusic} aria-label={musicOn ? 'Silenciar música' : 'Activar música'}>
          {musicOn ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/>
              <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          )}
        </button>

        <img className="rl__logo" src="/assets/logo-bulebule.png" alt="Bule Bule" draggable={false} />

        {user && (
          <button className="rl__avatar" onClick={onSettings} aria-label="Ajustes">
            {user.picture
              ? <img src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
              : <span>{initials}</span>
            }
          </button>
        )}
      </div>

      {/* Greeting */}
      <div className="rl__greeting">
        <span className="rl__greeting-name">
          {user?.name || playerName}
          {myStats && <TierDot tier={myStats.tier} />}
        </span>
        {myStats ? (
          <div className="rl__greeting-stats">
            <span className="rl__greeting-pts">{myStats.score.toLocaleString()} pts</span>
            {myRank && <span className="rl__greeting-rank">{myRank}/{rankTotal}</span>}
          </div>
        ) : !connected ? (
          <span className="rl__offline">Sin conexión</span>
        ) : null}
      </div>

      {/* Challenge cards carousel */}
      <div className="rl__challenges">
        <div className="rl__challenge-card" onClick={() => openSheet(true)}>
          <h3 className="rl__challenge-title">Reto semanal</h3>
          <p className="rl__challenge-desc">Juega una partida tú sólo contra la maquina</p>
        </div>
        <div className="rl__challenge-card" onClick={() => openSheet(true)}>
          <h3 className="rl__challenge-title">Solo Play</h3>
          <p className="rl__challenge-desc">Reta a la máquina en una partida rápida</p>
        </div>
        <div className="rl__challenge-card" onClick={() => openSheet(false)}>
          <h3 className="rl__challenge-title">Con amigos</h3>
          <p className="rl__challenge-desc">Crea una sala y comparte el código</p>
        </div>
      </div>

      {/* Google login for guests */}
      {!user && (
        <div className="rl__login-row">
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => setError('Error al iniciar sesión con Google')}
            shape="pill" size="medium" text="signin_with" locale="es"
          />
        </div>
      )}

      {/* Create room CTA */}
      <div className="rl__cta">
        <button className="rl__create-btn" onClick={() => openSheet(false)} disabled={!connected}>
          Crear sala
        </button>
      </div>

      {error && <p className="rl__error">{error}</p>}

      {/* Salas activas (solo si las hay) */}
      {rooms.length > 0 && (
        <div className="rl__rooms">
          {rooms.map(room => {
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
                <button
                  className="rl__join-btn"
                  onClick={() => handleJoinClick(room)}
                  disabled={!canJoin || joiningCode !== null || !connected}
                >
                  {joiningCode === room.code ? '...' : 'Unirse'}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Clasificación */}
      <div className="rl__ranking">
        <div className="rl__ranking-header">
          <h2 className="rl__ranking-title">Clasificación</h2>
          <button className="rl__icon-btn" aria-label="Filtrar" onClick={fetchStats}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>
              <circle cx="8"  cy="6"  r="2" fill="currentColor" stroke="none"/>
              <circle cx="16" cy="12" r="2" fill="currentColor" stroke="none"/>
              <circle cx="10" cy="18" r="2" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </div>

        {rankings.length === 0 ? (
          <p className="rl__empty">Juega partidas para aparecer en la clasificación</p>
        ) : rankings.map(r => (
          <div key={r.userId} className={`rl__rank-row${r.userId === user?.email ? ' rl__rank-row--me' : ''}`}>
            <span className="rl__rank-pos">{r.rank}</span>
            <span className="rl__rank-name">
              {r.name}
              <TierDot tier={r.tier} />
            </span>
            <span className="rl__rank-score">{r.score.toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* Bottom sheet */}
      {sheetState && (
        <CreateSheet
          playerName={playerName}
          user={user}
          initialVsBot={sheetState.vsBot}
          closing={sheetClosing}
          onClose={closeSheet}
        />
      )}

      {/* Private room code modal */}
      {codeModal && (
        <div className="modal-overlay" onClick={() => setCodeModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="modal-box__title">Sala privada</h3>
            <p className="modal-box__hint">Introduce el código para unirte a <strong>{codeModal.name}</strong></p>
            <input
              className="input input--code"
              maxLength={4}
              autoFocus
              value={codeInput}
              onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError('') }}
              onKeyDown={e => e.key === 'Enter' && joinByCode()}
              placeholder="XXXX"
            />
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
