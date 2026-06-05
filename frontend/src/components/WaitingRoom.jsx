import socket from '../socket'

export default function WaitingRoom({ room, myId }) {
  const isHost = room.hostId === myId

  function start() {
    socket.emit('start_game', (res) => {
      if (!res?.ok) alert(res?.error || 'Error al iniciar')
    })
  }

  return (
    <div className="waiting-room">
      <div className="waiting-room__top">
        <h2>Sala de espera</h2>
        <div className="room-code">
          <span className="room-code__label">Código</span>
          <span className="room-code__value">{room.code}</span>
        </div>
        <p className="waiting-room__hint">Comparte el código con los demás jugadores</p>
      </div>

      <div className="player-list">
        <p className="player-list__title">Jugadores ({room.players.length})</p>
        {room.players.map(p => (
          <div key={p.id} className="player-list__item">
            <span className="player-list__name">{p.name}</span>
            {p.id === room.hostId && <span className="badge">Host</span>}
            {p.id === myId && <span className="badge badge--you">Tú</span>}
          </div>
        ))}
      </div>

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
  )
}
