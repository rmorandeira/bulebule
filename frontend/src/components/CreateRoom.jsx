import { useState } from 'react'
import socket from '../socket'

const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8]

export default function CreateRoom({ playerName, onBack }) {
  const [roomName, setRoomName] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function create() {
    if (!playerName.trim()) return setError('Vuelve atrás e introduce tu nombre')
    if (!roomName.trim()) return setError('Ponle un nombre a la sala')
    setLoading(true)
    socket.emit('create_room', { playerName: playerName.trim(), roomName: roomName.trim(), maxPlayers }, (res) => {
      setLoading(false)
      if (!res?.ok) setError(res?.error || 'Error al crear la sala')
    })
  }

  return (
    <div className="screen create-room">
      <div className="create-room__header">
        <button className="btn-back" onClick={onBack}>← Volver</button>
        <h2 className="create-room__title">Nueva sala</h2>
      </div>

      <div className="create-room__form">
        <label className="form-label">Nombre de la sala</label>
        <input
          className="input"
          placeholder="Ej: Sala de Roi"
          value={roomName}
          maxLength={20}
          autoFocus
          onChange={e => { setRoomName(e.target.value); setError('') }}
          onKeyDown={e => e.key === 'Enter' && create()}
        />

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

        {error && <p className="error">{error}</p>}

        <button className="btn btn--primary btn--full" onClick={create} disabled={loading}>
          {loading ? 'Creando...' : 'Crear sala'}
        </button>
      </div>
    </div>
  )
}
