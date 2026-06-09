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
  const [animPhase, setAnimPhase] = useState('splash')

  useEffect(() => {
    const t1 = setTimeout(() => setAnimPhase('logo-center'), 350)
    const t2 = setTimeout(() => setAnimPhase('logo-top'), 2000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [])

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
    if (socket.connected) socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('rooms_list', onRoomsList)
    }
  }, [])

  function handleGoogleSuccess(credentialResponse) {
    const payload = decodeJwt(credentialResponse.credential)
    if (!payload) return setError('Error al iniciar sesión con Google')
    onLogin({ name: payload.name, email: payload.email, picture: payload.picture, googleId: payload.sub })
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

  const isFull = (r) => r.playerCount >= r.maxPlayers
  const sheetVisible = animPhase === 'logo-top'

  return (
    <div className="home">

      {/* Fondo con parallax zoom */}
      <div className="home__bg-wrapper">
        <div className="home__bg" />
      </div>

      {/* Logo BULE BULE — animado splash → center → top */}
      <img
        className={`home__logo home__logo--${animPhase}`}
        src="/assets/logo-bulebule.png"
        alt="Bule Bule"
        draggable={false}
      />

      {/* Sheet — aparece con slide-up cuando el logo llega arriba */}
      <div className={`home__sheet${sheetVisible ? '' : ' home__sheet--hidden'}`}>

        <div className={`home__conn-badge ${connected ? 'home__conn-badge--ok' : 'home__conn-badge--off'}`}>
          {connected ? 'Conectado' : 'Conectando...'}
        </div>

        {!user ? (
          <div className="home__login-card">
            <p className="home__login-hint">Inicia sesión para jugar</p>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setError('Error al iniciar sesión con Google')}
              shape="pill" size="large" text="signin_with" locale="es"
            />
            {error && <p className="home__error">{error}</p>}
          </div>
        ) : (
          <>
            {/* Tarjeta usuario */}
            <div className="home__user-card">
              <img className="home__avatar" src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
              <div className="home__user-info">
                <span className="home__user-name">{user.name}</span>
                <span className="home__user-email">{user.email}</span>
              </div>
              <button className="home__settings-btn" onClick={onSettings} aria-label="Ajustes">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            </div>

            {/* CTA principal */}
            <button
              className="home__create-btn"
              onClick={onCreateClick}
              disabled={!connected}
            >
              Nueva partida
            </button>

            {error && <p className="home__error">{error}</p>}

            {/* Panel salas */}
            <div className="home__rooms-panel">
              {rooms.length === 0 ? (
                <p className="home__rooms-empty">No hay salas abiertas</p>
              ) : (
                <div className="home__rooms-list">
                  {rooms.map(room => {
                    const canJoin = room.phase === 'lobby' && !isFull(room)
                    return (
                      <div key={room.code} className="home__room-card">
                        <div className="home__room-info">
                          <span className="home__room-name">{room.name}</span>
                          <div className="home__room-meta">
                            <span>{room.playerCount}/{room.maxPlayers} Jugadores</span>
                            {canJoin
                              ? <span className="home__room-status">ESPERANDO</span>
                              : <span className="home__room-status home__room-status--full">{isFull(room) ? 'Llena' : 'En curso'}</span>
                            }
                          </div>
                        </div>
                        <button
                          className="home__join-btn"
                          onClick={() => join(room.code)}
                          disabled={!canJoin || joiningCode !== null || !connected}
                        >
                          {joiningCode === room.code ? '...' : 'Unirse'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

            </div>
          </>
        )}
      </div>

    </div>
  )
}
