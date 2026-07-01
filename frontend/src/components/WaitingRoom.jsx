import { useState, useMemo } from 'react'
import socket from '../socket'
import UserDetailSheet from './UserDetailSheet'

function getFavorites() {
  try { return JSON.parse(localStorage.getItem('bule_favorites') ?? '{}') } catch { return {} }
}

export default function WaitingRoom({ room, myId, onLeave, user, playerName }) {
  const isHost = room.hostId === myId
  const [viewingUser, setViewingUser] = useState(null)
  const [inviting, setInviting] = useState({})

  const favorites = useMemo(() => {
    const favs = getFavorites()
    const inRoom = new Set(room.players.map(p => p.userId).filter(Boolean))
    return Object.entries(favs)
      .filter(([userId]) => userId !== user?.email && !inRoom.has(userId))
      .map(([userId, data]) => ({ userId, ...data }))
  }, [room.players, user?.email])

  function inviteFavorite(userId) {
    if (inviting[userId]) return
    setInviting(s => ({ ...s, [userId]: true }))
    socket.emit('invite_to_room', { toUserId: userId, roomCode: room.code, roomName: room.name })
  }

  function shareWhatsApp() {
    const origin = import.meta.env.VITE_APP_URL || window.location.origin
    const url = `${origin}/?join=${room.code}`
    const text = room.isPrivate
      ? `¡Te invito a jugar al Bule Bule! 🎲\nSala privada: ${room.name}\nCódigo: ${room.code}\nÚnete con este enlace: ${url}`
      : `¡Te invito a jugar al Bule Bule! 🎲\nSala: ${room.name}\nÚnete aquí: ${url}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  }

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
      {viewingUser && (
        <UserDetailSheet
          userId={viewingUser.userId}
          initialName={viewingUser.name}
          initialPicture={viewingUser.picture}
          user={user}
          playerName={playerName}
          hideChallenge
          onClose={() => setViewingUser(null)}
        />
      )}
      <div className="waiting-room__top">
        <div className="waiting-room__topbar">
          <button className="btn-back" onClick={leave}>← Salir</button>
          {room.isPrivate && <span className="room-code-badge">{room.code}</span>}
        </div>
        <h2 className="waiting-room__title">
          {room.isChallenge && (
            <svg style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
              <line x1="13" y1="19" x2="19" y2="13"/>
              <line x1="16" y1="16" x2="20" y2="20"/>
              <line x1="19" y1="21" x2="21" y2="19"/>
              <polyline points="9.5 6.5 6 3 3 3 3 6 6.5 9.5"/>
              <line x1="5" y1="11" x2="11" y2="5"/>
              <line x1="8" y1="8" x2="4" y2="4"/>
            </svg>
          )}
          {room.name}
        </h2>
        {room.isChallenge ? (
          room.players.length < 2 && (
            <div className="wr__favorites">
              <div className="wr__fav-row">
                <div className="wr__fav-avatar wr__fav-avatar--placeholder" />
                <span className="wr__fav-name">{room.challengedName ?? 'Jugador'}</span>
                <span className="wr__fav-invite wr__fav-invite--sent">Pendiente</span>
              </div>
            </div>
          )
        ) : (
          <>
            <p className="waiting-room__hint">
              {room.isPrivate ? 'Comparte el código para que se unan' : 'Invita a tus amigos a unirse'}
            </p>
            <button className="btn-whatsapp" onClick={shareWhatsApp}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Invitar por WhatsApp
            </button>

            {user && favorites.length > 0 && (
              <div className="wr__favorites">
                <p className="wr__favorites-title">★ Favoritos</p>
                {favorites.map(f => (
                  <div key={f.userId} className="wr__fav-row">
                    {f.picture
                      ? <img src={f.picture} referrerPolicy="no-referrer" className="wr__fav-avatar" />
                      : <div className="wr__fav-avatar wr__fav-avatar--placeholder" />
                    }
                    <span className="wr__fav-name">{f.name}</span>
                    <button
                      className={`wr__fav-invite${inviting[f.userId] ? ' wr__fav-invite--sent' : ''}`}
                      onClick={() => inviteFavorite(f.userId)}
                      disabled={!!inviting[f.userId]}
                    >
                      {inviting[f.userId] ? 'Pendiente' : 'Invitar'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="player-list">
        <p className="player-list__title">
          Jugadores
        </p>
        {room.players.map(p => (
          <div
            key={p.id}
            className={`player-list__item${p.userId ? ' player-list__item--clickable' : ''}`}
            onClick={() => p.userId && setViewingUser({ userId: p.userId, name: p.name, picture: null })}
          >
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
