import { useState, useEffect } from 'react'
import socket from './socket'
import Lobby from './components/Lobby'
import WaitingRoom from './components/WaitingRoom'
import GameBoard from './components/GameBoard'

export default function App() {
  const [room, setRoom] = useState(null)
  const [myId, setMyId] = useState(null)

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id))
    socket.on('room_state', setRoom)
    if (socket.connected) setMyId(socket.id)
    return () => { socket.off('connect'); socket.off('room_state') }
  }, [])

  if (!room) return <Lobby />
  if (room.phase === 'lobby') return <WaitingRoom room={room} myId={myId || socket.id} />
  return <GameBoard room={room} myId={myId || socket.id} onLeave={() => setRoom(null)} />
}
