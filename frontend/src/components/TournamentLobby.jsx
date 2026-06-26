import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

const TIER_COLOR  = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }
const CLOSE_DURATION = 260

export default function TournamentLobby({ tournament, user, playerName, onBack, onViewUser }) {
  const [lobbyState, setLobbyState]   = useState({ players: [], rooms: [] })
  const [canPlay, setCanPlay]         = useState(false)
  const [myTier, setMyTier]           = useState(null)
  const [joined, setJoined]           = useState(false)
  const [createSheet, setCreateSheet] = useState(false)
  const [createClosing, setCreateClosing] = useState(false)
  const [roomName, setRoomName]       = useState('')
  const [maxPlayers, setMaxPlayers]   = useState(6)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating]       = useState(false)
  const [joiningCode, setJoiningCode] = useState(null)
  const [error, setError]             = useState('')
  const closeRef = useRef(null)

  useEffect(() => {
    function onState(state) {
      if (state.tournamentId === tournament.id) setLobbyState(state)
    }
    socket.on('tournament_state', onState)

    socket.emit('join_tournament', {
      tournamentId: tournament.id,
      userId: user?.email ?? null,
      name: user?.name ?? playerName,
      picture: user?.picture ?? null,
    }, (res) => {
      if (res?.ok) {
        setCanPlay(res.canPlay)
        setMyTier(res.tier)
        setJoined(true)
      }
    })

    return () => {
      socket.off('tournament_state', onState)
      socket.emit('leave_tournament')
    }
  }, [tournament.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function openCreate() {
    clearTimeout(closeRef.current)
    setCreateClosing(false)
    setCreateSheet(true)
    setRoomName('')
    setCreateError('')
  }
  function closeCreate() {
    setCreateClosing(true)
    closeRef.current = setTimeout(() => { setCreateSheet(false); setCreateClosing(false) }, CLOSE_DURATION)
  }

  function handleCreate() {
    if (!roomName.trim()) return setCreateError('Ponle un nombre a la sala')
    setCreating(true)
    socket.emit('create_room', {
      playerName: user?.name ?? playerName,
      roomName: roomName.trim(),
      maxPlayers,
      vsBot: false,
      maxRounds: 0,
      isPrivate: false,
      tournamentId: tournament.id,
      userId: user?.email ?? null,
    }, (res) => {
      setCreating(false)
      if (!res?.ok) return setCreateError(res?.error ?? 'Error al crear la sala')
      closeCreate()
    })
  }

  function handleJoin(room) {
    if (joiningCode) return
    const name = user?.name ?? playerName
    setJoiningCode(room.code)
    socket.emit('join_room', { code: room.code, playerName: name }, (res) => {
      setJoiningCode(null)
      if (!res?.ok) setError(res?.error ?? 'No se pudo unir a la sala')
    })
  }

  const tierColor = TIER_COLOR[tournament.tier]
  const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8]

  return (
    <div className="tlob">
      {/* Header */}
      <div className="tlob__header">
        <button className="tlob__back" onClick={onBack} aria-label="Volver">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div className="tlob__title-wrap">
          <span className="tlob__tier-dot" style={{ background: tierColor }} />
          <span className="tlob__title">{tournament.name}</span>
        </div>
        {joined && (
          <span className={`tlob__access ${canPlay ? 'tlob__access--ok' : 'tlob__access--no'}`}>
            {canPlay ? 'Puedes jugar' : 'Solo espectador'}
          </span>
        )}
      </div>

      {error && <p className="tlob__error">{error}</p>}

      {/* Players in lobby */}
      <div className="tlob__section">
        <p className="tlob__section-title">EN SALA ({lobbyState.players.length})</p>
        {lobbyState.players.length === 0 ? (
          <p className="tlob__empty">No hay nadie en el lobby todavía</p>
        ) : (
          <div className="tlob__players">
            {lobbyState.players.map(p => (
              <div
                key={p.socketId}
                className={`tlob__player${p.userId ? ' tlob__player--clickable' : ''}`}
                onClick={() => p.userId && onViewUser?.({ userId: p.userId, name: p.name, picture: p.picture ?? null })}
              >
                {p.picture ? (
                  <img src={p.picture} alt={p.name} referrerPolicy="no-referrer" className="tlob__avatar" />
                ) : (
                  <div className="tlob__avatar tlob__avatar--placeholder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                  </div>
                )}
                <span className="tlob__player-name">{p.name}</span>
                <span className="tlob__tier-pill" style={{ background: TIER_COLOR[p.tier] ?? TIER_COLOR.Bronce }}>
                  {p.tier}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open rooms */}
      <div className="tlob__section">
        <p className="tlob__section-title">PARTIDAS ABIERTAS</p>
        {lobbyState.rooms.filter(r => r.phase === 'lobby').length === 0 ? (
          <p className="tlob__empty">No hay partidas abiertas</p>
        ) : (
          lobbyState.rooms.filter(r => r.phase === 'lobby').map(room => (
            <div key={room.code} className="tlob__room">
              <div className="tlob__room-info">
                <span className="tlob__room-name">{room.name}</span>
                <span className="tlob__room-meta">{room.playerCount} / {room.maxPlayers} jugadores</span>
              </div>
              <button
                className="rl__join-btn"
                onClick={() => handleJoin(room)}
                disabled={joiningCode !== null || room.playerCount >= room.maxPlayers}>
                {joiningCode === room.code ? '...' : 'Unirse'}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Active games */}
      {lobbyState.rooms.filter(r => r.phase !== 'lobby').length > 0 && (
        <div className="tlob__section">
          <p className="tlob__section-title">EN CURSO</p>
          {lobbyState.rooms.filter(r => r.phase !== 'lobby').map(room => (
            <div key={room.code} className="tlob__room tlob__room--active">
              <div className="tlob__room-info">
                <span className="tlob__room-name">{room.name}</span>
                <span className="tlob__room-meta">{room.playerCount} jugadores · en curso</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create room bar */}
      <div className="rl__create-bar">
        <button
          className="rl__create-bar-btn"
          onClick={openCreate}
          disabled={!canPlay}>
          {canPlay ? 'Crear sala' : `Necesitas nivel ${tournament.tier}`}
        </button>
      </div>

      {/* Create sheet */}
      {createSheet && (
        <>
          <div className={`bs-overlay${createClosing ? ' bs-overlay--closing' : ''}`} onClick={closeCreate} />
          <div className={`bs${createClosing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
            <div className="bs__handle" />
            <p className="bs__label">NOMBRE DE LA SALA</p>
            <input
              className="bs__input"
              placeholder="Ej: Sala de Roi"
              value={roomName}
              maxLength={20}
              autoFocus
              onChange={e => { setRoomName(e.target.value); setCreateError('') }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <p className="bs__label">JUGADORES MÁXIMOS</p>
            <div className="bs__pills">
              {MAX_PLAYERS_OPTIONS.map(n => (
                <button key={n} className={`bs__pill${maxPlayers === n ? ' bs__pill--active' : ''}`}
                  onClick={() => setMaxPlayers(n)}>{n}</button>
              ))}
            </div>
            {createError && <p className="bs__error">{createError}</p>}
            <button className="bs__submit" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creando...' : 'Crear sala'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
