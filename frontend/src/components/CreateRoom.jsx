import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8]

export default function CreateRoom({ playerName, user, onBack }) {
  const [vsBot, setVsBot] = useState(false)
  const [roomName, setRoomName] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [invitedFriends, setInvitedFriends] = useState([])
  const searchTimerRef = useRef(null)

  const canInvite = !vsBot && !!user

  useEffect(() => {
    if (!canInvite || searchQuery.length < 2) {
      setSearchResults([])
      return
    }
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      socket.emit('search_users', { query: searchQuery }, (res) => {
        const filtered = (res?.users ?? []).filter(u => !invitedFriends.find(f => f.userId === u.userId))
        setSearchResults(filtered)
      })
    }, 300)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchQuery, canInvite])

  function addFriend(friend) {
    setInvitedFriends(prev => prev.find(f => f.userId === friend.userId) ? prev : [...prev, friend])
    setSearchQuery('')
    setSearchResults([])
  }

  function removeFriend(userId) {
    setInvitedFriends(prev => prev.filter(f => f.userId !== userId))
  }

  function create() {
    if (!playerName.trim()) return setError('Vuelve atrás e introduce tu nombre')
    if (!roomName.trim()) return setError('Ponle un nombre a la sala')
    setLoading(true)
    socket.emit('create_room', {
      playerName: playerName.trim(),
      roomName: roomName.trim(),
      maxPlayers: vsBot ? 2 : maxPlayers,
      vsBot,
    }, (res) => {
      setLoading(false)
      if (!res?.ok) return setError(res?.error || 'Error al crear la sala')
      invitedFriends.forEach(friend => {
        socket.emit('invite_to_room', { toUserId: friend.userId, roomCode: res.code, roomName: roomName.trim() })
      })
    })
  }

  return (
    <div className="screen create-room">
      <div className="create-room__header">
        <button className="btn-back" onClick={onBack}>← Volver</button>
        <h2 className="create-room__title">Nueva sala</h2>
      </div>

      <div className="create-room__form">

        <label className="form-label">Modo de juego</label>
        <div className="mode-selector">
          <button
            className={`mode-btn ${!vsBot ? 'mode-btn--active' : ''}`}
            onClick={() => setVsBot(false)}
          >
            <span className="mode-btn__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </span>
            Multijugador
          </button>
          <button
            className={`mode-btn ${vsBot ? 'mode-btn--active' : ''}`}
            onClick={() => setVsBot(true)}
          >
            <span className="mode-btn__icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                <line x1="12" y1="15" x2="12" y2="17"/>
              </svg>
            </span>
            Vs máquina
          </button>
        </div>

        <label className="form-label">Nombre de la sala</label>
        <input
          className="input"
          placeholder={vsBot ? 'Ej: Mi partida' : 'Ej: Sala de Roi'}
          value={roomName}
          maxLength={20}
          autoFocus
          onChange={e => { setRoomName(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && create()}
        />

        {!vsBot && (
          <>
            <label className="form-label">Jugadores máximos</label>
            <div className="max-players-selector">
              {MAX_PLAYERS_OPTIONS.map(n => (
                <button
                  key={n}
                  className={`max-players-btn ${maxPlayers === n ? 'max-players-btn--active' : ''}`}
                  onClick={() => setMaxPlayers(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </>
        )}

        {vsBot && (
          <p className="create-room__bot-hint">
            Jugarás contra el ordenador en una partida de 2 jugadores.
          </p>
        )}

        {canInvite && (
          <div className="invite-section">
            <label className="form-label">Invitar amigos</label>

            {invitedFriends.length > 0 && (
              <div className="invited-chips">
                {invitedFriends.map(f => (
                  <span key={f.userId} className="invited-chip">
                    {f.picture && <img src={f.picture} alt="" className="invited-chip__avatar" referrerPolicy="no-referrer" />}
                    {f.name}
                    <button className="invited-chip__remove" onClick={() => removeFriend(f.userId)} aria-label="Quitar">×</button>
                  </span>
                ))}
              </div>
            )}

            <div className="invite-search">
              <input
                className="input"
                placeholder="Buscar por nombre..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchResults.length > 0 && (
                <ul className="invite-results">
                  {searchResults.map(u => (
                    <li key={u.userId} className="invite-result-item" onClick={() => addFriend(u)}>
                      {u.picture && <img src={u.picture} alt="" className="invite-result-item__avatar" referrerPolicy="no-referrer" />}
                      <span>{u.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <button className="btn btn--primary btn--full" onClick={create} disabled={loading}>
          {loading ? 'Creando...' : vsBot ? 'Jugar' : 'Crear sala'}
        </button>
      </div>
    </div>
  )
}
