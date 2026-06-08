import { useState, useEffect } from 'react'
import { GoogleLogin, googleLogout } from '@react-oauth/google'
import socket from '../socket'

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

export default function Lobby({ user, onLogin, onLogout }) {
  const [name, setName] = useState(user?.name || '')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(socket.connected)

  useEffect(() => {
    if (user?.name) setName(user.name)
  }, [user?.name])

  useEffect(() => {
    function onConnect() { setConnected(true) }
    function onDisconnect() { setConnected(false) }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect) }
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

  function handleLogout() {
    googleLogout()
    onLogout()
    setName('')
  }

  function create() {
    if (!connected) return setError('Sin conexión al servidor')
    if (!name.trim()) return setError('Introduce tu nombre')
    setLoading(true)
    socket.emit('create_room', { playerName: name.trim() }, (res) => {
      setLoading(false)
      if (!res?.ok) setError(res?.error || 'Error al crear sala')
    })
  }

  function join() {
    if (!connected) return setError('Sin conexión al servidor')
    if (!name.trim()) return setError('Introduce tu nombre')
    if (code.trim().length < 4) return setError('El código tiene 4 caracteres')
    setLoading(true)
    socket.emit('join_room', { code: code.trim().toUpperCase(), playerName: name.trim() }, (res) => {
      setLoading(false)
      if (!res?.ok) setError(res?.error || 'Sala no encontrada')
    })
  }

  return (
    <div className="lobby">
      <div className="lobby__header">
        <h1 className="lobby__title">Bule<br />Bule</h1>
        <p className="lobby__subtitle">A K Q J 10 9</p>
      </div>

      <div className="lobby__form">
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
          </div>
        ) : (
          <>
            <div className="user-card">
              <img className="user-card__avatar" src={user.picture} alt={user.name} referrerPolicy="no-referrer" />
              <div className="user-card__info">
                <span className="user-card__name">{user.name}</span>
                <span className="user-card__email">{user.email}</span>
              </div>
              <button className="user-card__logout" onClick={handleLogout}>Salir</button>
            </div>

            <input
              className="input"
              placeholder="Nombre en partida"
              value={name}
              maxLength={12}
              onChange={e => { setName(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && create()}
            />

            {error && <p className="error">{error}</p>}

            <button className="btn btn--primary" onClick={create} disabled={loading || !connected}>
              Crear sala
            </button>

            <div className="divider"><span>o únete a una</span></div>

            <div className="join-row">
              <input
                className="input input--code"
                placeholder="CÓDIGO"
                value={code}
                maxLength={4}
                onChange={e => { setCode(e.target.value.toUpperCase()); setError('') }}
                onKeyDown={e => e.key === 'Enter' && join()}
              />
              <button className="btn btn--secondary" onClick={join} disabled={loading || !connected}>
                Unirse
              </button>
            </div>
          </>
        )}

        {!user && error && <p className="error">{error}</p>}
      </div>
    </div>
  )
}
