import { useState, useEffect } from 'react'
import socket from './socket'
import RoomList from './components/RoomList'
import CreateRoom from './components/CreateRoom'
import WaitingRoom from './components/WaitingRoom'
import GameBoard from './components/GameBoard'

export default function App() {
  const [screen, setScreen] = useState('list') // 'list' | 'create'
  const [room, setRoom] = useState(null)
  const [myId, setMyId] = useState(null)
  const [playerName, setPlayerName] = useState('')

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id))
    socket.on('room_state', setRoom)
    socket.on('room_destroyed', () => { setRoom(null); setScreen('list') })
    if (socket.connected) setMyId(socket.id)
    return () => {
      socket.off('connect')
      socket.off('room_state')
      socket.off('room_destroyed')
    }
  }, [])

  function handleLeave() {
    setRoom(null)
    setScreen('list')
  }

  if (room) {
    if (room.phase === 'lobby') {
      return <WaitingRoom room={room} myId={myId || socket.id} onLeave={handleLeave} />
    }
    return <GameBoard room={room} myId={myId || socket.id} onLeave={handleLeave} />
  }

  if (screen === 'create') {
    return (
      <CreateRoom
        playerName={playerName}
        onBack={() => setScreen('list')}
      />
    )
  }

  return (
    <RoomList
      playerName={playerName}
      onNameChange={setPlayerName}
      onCreateClick={() => setScreen('create')}
    />
  )
}
