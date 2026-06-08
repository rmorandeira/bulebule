import { useState, useEffect, useRef } from 'react'
import socket from './socket'
import RoomList from './components/RoomList'
import CreateRoom from './components/CreateRoom'
import WaitingRoom from './components/WaitingRoom'
import GameBoard from './components/GameBoard'
import UserSettings from './components/UserSettings'

function loadUser() {
  try { return JSON.parse(localStorage.getItem('bule_user')) } catch { return null }
}

async function setupPush(userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
  try {
    const reg = await navigator.serviceWorker.ready
    const { key } = await fetch('/api/vapid-public-key').then(r => r.json())
    const existing = await reg.pushManager.getSubscription()
    const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    socket.emit('subscribe_push', { userId, subscription: sub.toJSON() })
  } catch (e) {
    console.warn('Push setup failed:', e)
  }
}

export default function App() {
  const [screen, setScreen] = useState('list') // 'list' | 'create' | 'settings'
  const [room, setRoom] = useState(null)
  const [myId, setMyId] = useState(null)
  const [user, setUser] = useState(loadUser)
  const [playerName, setPlayerName] = useState(() => loadUser()?.name || '')
  const [pendingJoinCode, setPendingJoinCode] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('join')
    if (p) window.history.replaceState({}, '', '/')
    return p?.toUpperCase() || null
  })
  const swRegistered = useRef(false)

  // Register service worker once
  useEffect(() => {
    if (!swRegistered.current && 'serviceWorker' in navigator) {
      swRegistered.current = true
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          // Handle navigation messages from SW notification click
          navigator.serviceWorker.addEventListener('message', e => {
            if (e.data?.type === 'JOIN_ROOM') {
              const code = new URLSearchParams(new URL(e.data.url, location.origin).search).get('join')
              if (code) setPendingJoinCode(code.toUpperCase())
            }
          })
        })
        .catch(console.error)
    }
  }, [])

  useEffect(() => {
    socket.on('connect', () => setMyId(socket.id))
    socket.on('room_state', setRoom)
    socket.on('room_destroyed', () => { setRoom(null); setScreen('list') })
    socket.on('room_invite', ({ roomCode, roomName, inviterName }) => {
      if (window.confirm(`${inviterName} te invita a "${roomName}". ¿Unirse?`)) {
        const name = loadUser()?.name || playerName
        if (!name) return alert('Introduce tu nombre primero')
        socket.emit('join_room', { code: roomCode, playerName: name }, (res) => {
          if (!res?.ok) alert(res?.error || 'No se pudo unir a la sala')
        })
      }
    })
    if (socket.connected) setMyId(socket.id)
    return () => {
      socket.off('connect')
      socket.off('room_state')
      socket.off('room_destroyed')
      socket.off('room_invite')
    }
  }, [])

  // Register with backend so others can search + invite
  useEffect(() => {
    if (user && myId) {
      socket.emit('register_user', { userId: user.email, name: user.name, email: user.email, picture: user.picture })
      if (Notification.permission === 'granted') {
        setupPush(user.email)
      }
    }
  }, [user, myId])

  // Auto-join from push notification URL
  useEffect(() => {
    if (!pendingJoinCode || !myId) return
    const name = loadUser()?.name || playerName
    if (!name) return
    socket.emit('join_room', { code: pendingJoinCode, playerName: name }, (res) => {
      if (!res?.ok) alert(res?.error || 'No se pudo unir a la sala')
      setPendingJoinCode(null)
    })
  }, [pendingJoinCode, myId])

  function handleLogin(userData) {
    localStorage.setItem('bule_user', JSON.stringify(userData))
    setUser(userData)
    setPlayerName(userData.name)
    socket.emit('register_user', { userId: userData.email, name: userData.name, email: userData.email, picture: userData.picture })
    if ('Notification' in window) {
      Notification.requestPermission().then(perm => {
        if (perm === 'granted') setupPush(userData.email)
      })
    }
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
        user={user}
        onBack={() => setScreen('list')}
      />
    )
  }

  return (
    <RoomList
      user={user}
      playerName={playerName}
      onNameChange={setPlayerName}
      onLogin={handleLogin}
      onSettings={() => setScreen('settings')}
      onCreateClick={() => setScreen('create')}
    />
  )
}
