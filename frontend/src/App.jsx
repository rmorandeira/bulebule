import { useState, useEffect } from 'react'
import socket from './socket'
import RoomList from './components/RoomList'
import CreateRoom from './components/CreateRoom'
import WaitingRoom from './components/WaitingRoom'
import GameBoard from './components/GameBoard'
import UserSettings from './components/UserSettings'

function loadUser() {
  try { return JSON.parse(localStorage.getItem('bule_user')) } catch { return null }
}

export default function App() {
  const [screen, setScreen] = useState('list') // 'list' | 'create' | 'settings'
  const [room, setRoom] = useState(null)
  const [myId, setMyId] = useState(null)
  const [user, setUser] = useState(loadUser)
  const [playerName, setPlayerName] = useState(() => loadUser()?.name || '')

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

  function handleLogin(userData) {
    localStorage.setItem('bule_user', JSON.stringify(userData))
    setUser(userData)
    setPlayerName(userData.name)
  }

  function handleLogout() {
    localStorage.removeItem('bule_user')
    setUser(null)
    setPlayerName('')
    setRoom(null)
    setScreen('list')
  }

  function handleUpdateUser(updates) {
    const updated = { ...user, ...updates }
    localStorage.setItem('bule_user', JSON.stringify(updated))
    setUser(updated)
    if (updates.name) setPlayerName(updates.name)
  }

  function handleDeleteAccount() {
    localStorage.removeItem('bule_user')
    setUser(null)
    setPlayerName('')
    setRoom(null)
    setScreen('list')
  }

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

  if (screen === 'settings' && user) {
    return (
      <UserSettings
        user={user}
        onBack={() => setScreen('list')}
        onUpdate={handleUpdateUser}
        onLogout={handleLogout}
        onDeleteAccount={handleDeleteAccount}
      />
    )
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
    <>
      <RoomList
        user={user}
        playerName={playerName}
        onNameChange={setPlayerName}
        onLogin={handleLogin}
        onSettings={() => setScreen('settings')}
        onCreateClick={() => setScreen('create')}
      />
      <footer className="app-footer">v{__APP_VERSION__}</footer>
    </>
  )
}
