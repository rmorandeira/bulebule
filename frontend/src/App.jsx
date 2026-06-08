import { useState, useEffect } from 'react'
import socket from './socket'
import Lobby from './components/Lobby'
import WaitingRoom from './components/WaitingRoom'
import GameBoard from './components/GameBoard'
import UserSettings from './components/UserSettings'

function loadUser() {
  try { return JSON.parse(localStorage.getItem('bule_user')) } catch { return null }
}

export default function App() {
  const [room, setRoom] = useState(null)
  const [myId, setMyId] = useState(null)
  const [user, setUser] = useState(loadUser)
  const [screen, setScreen] = useState('lobby') // 'lobby' | 'settings'

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id))
    socket.on('room_state', setRoom)
    if (socket.connected) setMyId(socket.id)
    return () => { socket.off('connect'); socket.off('room_state') }
  }, [])

  function handleLogin(userData) {
    localStorage.setItem('bule_user', JSON.stringify(userData))
    setUser(userData)
  }

  function handleLogout() {
    localStorage.removeItem('bule_user')
    setUser(null)
    setRoom(null)
    setScreen('lobby')
  }

  function handleUpdateUser(updates) {
    const updated = { ...user, ...updates }
    localStorage.setItem('bule_user', JSON.stringify(updated))
    setUser(updated)
  }

  function handleDeleteAccount() {
    localStorage.removeItem('bule_user')
    setUser(null)
    setRoom(null)
    setScreen('lobby')
  }

  if (room) {
    if (room.phase === 'lobby') return <WaitingRoom room={room} myId={myId || socket.id} />
    return <GameBoard room={room} myId={myId || socket.id} onLeave={() => setRoom(null)} />
  }

  if (screen === 'settings' && user) {
    return (
      <UserSettings
        user={user}
        onBack={() => setScreen('lobby')}
        onUpdate={handleUpdateUser}
        onLogout={handleLogout}
        onDeleteAccount={handleDeleteAccount}
      />
    )
  }

  return (
    <Lobby
      user={user}
      onLogin={handleLogin}
      onLogout={handleLogout}
      onSettings={() => setScreen('settings')}
    />
  )
}
