import { useState, useEffect } from 'react'
import socket from '../socket'

export default function RoomList({ playerName, onNameChange, onCreateClick }) {
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
        <input
          className="input"
          placeholder="Tu nombre"
          value={playerName}
          maxLength={12}
          onChange={e => { onNameChange(e.target.value); setError('') }}
        />
        {error && <p className="error">{error}</p>}
      </div>

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
                      <span className={`room-item__status ${room.phase === 'lobby' && !isFull(room) ? 'status--waiting' : 'status--playing'}`}>
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
    </div>
  )
}
