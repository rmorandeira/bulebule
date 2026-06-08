import socket from '../socket'

export default function WaitingRoom({ room, myId, onLeave }) {
  const isHost = room.hostId === myId

  function start() {
    socket.emit('start_game', (res) => {
      if (!res?.ok) alert(res?.error || 'Error al iniciar')
    })
  }

  function leave() {
    if (isHost) {
      socket.emit('destroy_room', () => onLeave())
    } else {
      socket.emit('leave_room', () => onLeave())
    }
  }

  return (
    <div className="screen waiting-room">
      <div className="waiting-room__top">
        <div className="waiting-room__topbar">
          <button className="btn-back" onClick={leave}>← Salir</button>
          <span className="room-code-badge">{room.code}</span>
        </div>
        <h2 className="waiting-room__title">{room.name}</h2>
        <p className="waiting-room__hint">Comparte el código para que se unan</p>
      </div>

      <div className="player-list">
        <p className="player-list__title">
          Jugadores ({room.players.length}/{room.maxPlayers})
        </p>
        {room.players.map(p => (
          <div key={p.id} className="player-list__item">
            <span className="player-list__name">{p.name}</span>
            {p.id === room.hostId && <span className="badge">Host</span>}
            {p.id === myId && <span className="badge badge--you">Tú</span>}
          </div>
        ))}
      </div>

      <div className="waiting-room__footer">
        {isHost ? (
          <button
            className="btn btn--primary btn--full"
            onClick={start}
            disabled={room.players.length < 2}
          >
            {room.players.length < 2 ? 'Esperando jugadores...' : 'Iniciar partida'}
          </button>
        ) : (
          <p className="waiting-room__waiting">Esperando a que el host inicie la partida...</p>
        )}
      </div>
    </div>
  )
}
