import { useState, useEffect } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import socket from '../socket'

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

export default function RoomList({ user, playerName, onNameChange, onLogin, onSettings, onCreateClick }) {
  const [rooms, setRooms] = useState([])
  const [error, setError] = useState('')
  const [joiningCode, setJoiningCode] = useState(null)
  const [connected, setConnected] = useState(socket.connected)

  useEffect(() => {
    function onConnect() {
      setConnected(true)
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
    }
    function onDisconnect() { setConnected(false) }
    function onRoomsList(list) { setRooms(list) }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('rooms_list', onRoomsList)

    if (socket.connected) {
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('rooms_list', onRoomsList)
    }
  }, [])

  function handleGoogleSuccess(credentialResponse) {
    const payload = decodeJwt(credentialResponse.credential)
    if (!payload) return setError('Error al iniciar sesión con Google')
    onLogin({
      name: payload.name,
      email: payload.email,
      picture: payload.picture,
      googleId: payload.sub,
    })
    setError('')
  }

  function join(code) {
    if (!connected) return setError('Sin conexión al servidor')
    if (!playerName.trim()) return setError('Introduce tu nombre primero')
    setJoiningCode(code)
    socket.emit('join_room', { code, playerName: playerName.trim() }, (res) => {
      setJoiningCode(null)
      if (!res?.ok) setError(res?.error || 'No se pudo unir a la sala')
    })
  }

  const statusLabel = (phase) => phase === 'lobby' ? 'Esperando' : 'En curso'
  const isFull = (r) => r.playerCount >= r.maxPlayers

  return (
    <div className="screen room-list">
      <div className="room-list__header">
        <h1 className="lobby__title">Bule<br />Bule</h1>
        <p className="lobby__subtitle">A K Q J 10 9</p>
      </div>

      <div className="room-list__name-section">
        <div className={`conn-status ${connected ? 'conn-status--ok' : 'conn-status--off'}`}>
          {connected ? 'Conectado' : 'Conectando...'}
        </div>

        {!user ? (
          <div className="login-section">
            <p className="login-section__hint">Inicia sesión para jugar</p>
            <div className="login-section__btn">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Error al iniciar sesión con Google')}
                shape="pill"
                size="large"
                text="signin_with"
                locale="es"
              />
            </div>
            {error && <p className="error">{error}</p>}
          </div>
        ) : (
          <>
            <div className="user-card">
              <img className="user-card__avatar" src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
              <div className="user-card__info">
                <span className="user-card__name">{user.name}</span>
                <span className="user-card__email">{user.email}</span>
              </div>
              <button className="user-card__settings" onClick={onSettings} aria-label="Ajustes de cuenta">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            </div>

            <input
              className="input"
              placeholder="Nombre en partida"
              value={playerName}
              maxLength={12}
              onChange={e => { onNameChange(e.target.value); setError('') }}
            />
            {error && <p className="error">{error}</p>}
          </>
        )}
      </div>

      {user && (
        <>
          <div className="room-list__rooms">
            <p className="room-list__section-title">Salas disponibles</p>
            {rooms.length === 0 ? (
              <p className="room-list__empty">No hay salas. ¡Crea la primera!</p>
            ) : (
              <div className="room-list__items">
                {rooms.map(room => {
                  const canJoin = room.phase === 'lobby' && !isFull(room)
                  return (
                    <div key={room.code} className="room-item">
                      <div className="room-item__info">
                        <span className="room-item__name">{room.name}</span>
                        <div className="room-item__meta">
                          <span className="room-item__players">
                            {room.playerCount}/{room.maxPlayers} jugadores
                          </span>
                          <span className={`room-item__status ${canJoin ? 'status--waiting' : 'status--playing'}`}>
                            {isFull(room) ? 'Llena' : statusLabel(room.phase)}
                          </span>
                        </div>
                      </div>
                      <button
                        className="btn btn--secondary btn--sm"
                        onClick={() => join(room.code)}
                        disabled={!canJoin || joiningCode !== null || !connected}
                      >
                        {joiningCode === room.code ? '...' : canJoin ? 'Unirse' : room.phase !== 'lobby' ? 'En curso' : 'Llena'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="room-list__footer">
            <button
              className="btn btn--primary btn--full"
              onClick={onCreateClick}
              disabled={!connected}
            >
              + Crear sala
            </button>
          </div>
        </>
      )}
    </div>
  )
}
