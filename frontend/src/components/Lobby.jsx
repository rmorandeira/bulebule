import { useState, useEffect } from 'react'
import socket from '../socket'

export default function Lobby() {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(socket.connected)

  useEffect(() => {
    function onConnect() { setConnected(true) }
    function onDisconnect() { setConnected(false) }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect) }
  }, [])

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
        <h1 className="lobby__title">Poker<br />de Dados</h1>
        <p className="lobby__subtitle">A K Q J 10 9</p>
      </div>

      <div className="lobby__form">
        <div className={`conn-status ${connected ? 'conn-status--ok' : 'conn-status--off'}`}>
          {connected ? 'Conectado' : 'Conectando...'}
        </div>

        <input
          className="input"
          placeholder="Tu nombre"
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
      </div>
    </div>
  )
}
