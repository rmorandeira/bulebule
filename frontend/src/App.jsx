import { useState, useEffect, useRef } from 'react'
import socket from './socket'
import { track } from './analytics'
import RoomList from './components/RoomList'
import CreateRoom from './components/CreateRoom'
import WaitingRoom from './components/WaitingRoom'
import GameBoard from './components/GameBoard'

function loadUser() {
  try { return JSON.parse(localStorage.getItem('bule_user')) } catch { return null }
}

const GUEST_NAMES = [
  'neno', 'el_pirri', 'el_chiri', 'platanito', 'murdoc', 'la_rebekita',
  'moreno_das_amorosas', 'el_manolo', 'la_choni', 'el_fiti', 'perico',
  'el_chupi', 'la_niña', 'el_raton', 'churri', 'el_gordo', 'la_flaca',
  'pepito', 'la_rubia', 'cachopo', 'el_tarchi', 'el_beni', 'la_puri',
  'xan_o_bravo', 'la_turra', 'el_mago', 'maricarmen', 'el_cabra',
  'kiko_el_raro', 'la_petra', 'el_señor_proper', 'tio_crispín',
]

function loadGuestName() {
  const saved = localStorage.getItem('bule_guest')
  if (saved) return saved
  const name = GUEST_NAMES[Math.floor(Math.random() * GUEST_NAMES.length)]
  const num = String(Math.floor(Math.random() * 900) + 100)
  const generated = `${name}_${num}`
  localStorage.setItem('bule_guest', generated)
  return generated
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
  const [screen, setScreen] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('join')
    return p ? 'list' : 'intro'
  }) // 'intro' | 'list' | 'create'
  const [room, setRoom] = useState(null)
  const [myId, setMyId] = useState(null)
  const [user, setUser] = useState(loadUser)
  const [playerName, setPlayerName] = useState(() => loadUser()?.name || loadGuestName())
  const [pendingJoinCode, setPendingJoinCode] = useState(() => {
    const p = new URLSearchParams(window.location.search).get('join')
    if (p) window.history.replaceState({}, '', '/')
    return p?.toUpperCase() || null
  })
  const [introBgVisible, setIntroBgVisible] = useState(false)
  const [introLogoPhase, setIntroLogoPhase] = useState('hidden')
  const [introLeaving, setIntroLeaving] = useState(false)
  useEffect(() => {
    if (screen !== 'intro') return
    const r = requestAnimationFrame(() => setIntroBgVisible(true))
    const t1 = setTimeout(() => setIntroLogoPhase('center'), 300)
    return () => { cancelAnimationFrame(r); clearTimeout(t1) }
  }, [screen])
  function handleComenzar() {
    setIntroLeaving(true)
    setTimeout(() => setScreen('list'), 500)
  }
  const [musicOn, setMusicOn] = useState(() => localStorage.getItem('bule_music') !== 'off')
  const [abandonedBy, setAbandonedBy] = useState(null)
  const swRegistered       = useRef(false)
  const sessionTrackedRef  = useRef(false)
  const roomRef            = useRef(null)
  const playerNameRef      = useRef(playerName)
  const musicRef           = useRef(null)
  const gameMusicRef  = useRef(null)
  const musicOnRef    = useRef(musicOn)
  musicOnRef.current  = musicOn

  // ── Música de lobby ──────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio('/assets/bule-escaleira.mp3')
    audio.loop   = true
    audio.volume = 0.55
    musicRef.current = audio

    function tryPlay() {
      if (musicOnRef.current) audio.play().catch(() => {})
    }
    document.addEventListener('click',      tryPlay, { once: true })
    document.addEventListener('touchstart', tryPlay, { once: true })

    return () => {
      audio.pause()
      document.removeEventListener('click',      tryPlay)
      document.removeEventListener('touchstart', tryPlay)
    }
  }, [])

  // ── Música de partida ────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio('/assets/dice-lemonlight.mp3')
    audio.loop   = true
    audio.volume = 0.2
    gameMusicRef.current = audio
    return () => { audio.pause() }
  }, [])

  // ── Lobby: para en partida o al silenciar; partida: para en lobby o al silenciar
  const inGame = !!(room && room.phase !== 'lobby')
  useEffect(() => {
    const lobby = musicRef.current
    const game  = gameMusicRef.current
    if (!lobby || !game) return
    if (inGame || !musicOn) lobby.pause()
    else                    lobby.play().catch(() => {})
    if (!inGame || !musicOn) game.pause()
    else                     game.play().catch(() => {})
  }, [inGame, musicOn])

  function toggleMusic() {
    // Ref actualizado en síncrono: el listener global tryPlay del primer
    // gesto puede dispararse justo después de este mismo click
    const next = !musicOnRef.current
    musicOnRef.current = next
    localStorage.setItem('bule_music', next ? 'on' : 'off')
    setMusicOn(next)
  }

  // ── Sonido global de botones ─────────────────────────────────────────────────
  useEffect(() => {
    const snd = new Audio('/assets/button_press.mp3')
    function onButtonClick(e) {
      const btn = e.target.closest('button')
      if (!btn || btn.textContent.trim() === 'Tirar dados') return
      snd.currentTime = 0
      snd.play().catch(() => {})
    }
    document.addEventListener('click', onButtonClick)
    return () => document.removeEventListener('click', onButtonClick)
  }, [])

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

  // Track session type once after first socket connect
  useEffect(() => {
    if (!myId || sessionTrackedRef.current) return
    sessionTrackedRef.current = true
    if (!user) track('session_guest')
  }, [myId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { roomRef.current = room }, [room])
  useEffect(() => { playerNameRef.current = playerName }, [playerName])

  useEffect(() => {
    socket.on('connect', () => {
      setMyId(socket.id)
      // Rejoin lobby after mobile app-switch reconnect
      const r = roomRef.current
      if (r?.phase === 'lobby') {
        socket.emit('join_room', { code: r.code, playerName: playerNameRef.current })
      }
    })
    socket.on('room_state', setRoom)
    socket.on('room_destroyed', ({ byPlayer } = {}) => {
      setRoom(null)
      setScreen('list')
      if (byPlayer) setAbandonedBy(byPlayer)
    })
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
    track('login_google')
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

  function handleGuestNameChange(name) {
    localStorage.setItem('bule_guest', name)
    setPlayerName(name)
  }

  function handleLogout() {
    localStorage.removeItem('bule_user')
    setUser(null)
    setPlayerName(loadGuestName())
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
    setPlayerName(loadGuestName())
    setRoom(null)
    setScreen('list')
  }

  function handleLeave() {
    setRoom(null)
    setScreen('list')
  }

  if (screen === 'intro') {
    return (
      <div className={`intro${introLeaving ? ' intro--leaving' : ''}`}>
        <div className="intro__bg-wrapper">
          <div className={`intro__bg${introBgVisible ? ' intro__bg--visible' : ''}`} />
        </div>
        <button className="intro__music-btn" onClick={toggleMusic} aria-label={musicOn ? 'Silenciar música' : 'Activar música'}>
          {musicOn ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/>
              <line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          )}
        </button>
        <img
          className={`intro__logo intro__logo--${introLogoPhase}`}
          src="/assets/logo-bulebule.png"
          alt="Bule Bule"
          draggable={false}
        />
        <button
          className={`intro__btn${introLogoPhase === 'center' ? ' intro__btn--visible' : ''}`}
          onClick={handleComenzar}
        >
          Comenzar
        </button>
        <p className="intro__version">v{__APP_VERSION__}</p>
      </div>
    )
  }

  if (room) {
    if (room.phase === 'lobby') {
      return <WaitingRoom room={room} myId={myId || socket.id} onLeave={handleLeave} />
    }
    return <GameBoard room={room} myId={myId || socket.id} onLeave={handleLeave} musicOn={musicOn} onToggleMusic={toggleMusic} />
  }

  if (screen === 'create') {
    return (
      <CreateRoom
        playerName={playerName}
        user={user}
        onBack={() => setScreen('list')}
        musicOn={musicOn}
        onToggleMusic={toggleMusic}
      />
    )
  }

  if (screen === 'user' && user) {
    return (
      <UserSection
        user={user}
        onBack={() => setScreen('list')}
        onUpdate={handleUpdateUser}
        onLogout={() => { handleLogout(); setScreen('list') }}
        onDeleteAccount={() => { handleDeleteAccount(); setScreen('list') }}
      />
    )
  }

  return (
    <>
      <RoomList
        user={user}
        musicOn={musicOn}
        onToggleMusic={toggleMusic}
        playerName={playerName}
        onNameChange={handleGuestNameChange}
        onLogin={handleLogin}
        onUpdate={handleUpdateUser}
        onLogout={handleLogout}
        onDeleteAccount={handleDeleteAccount}
      />
      {abandonedBy && (
        <div className="modal-overlay">
          <div className="modal" role="alertdialog" aria-modal="true">
            <h2 className="modal__title">Partida terminada</h2>
            <p className="modal__text">{abandonedBy} ha abandonado la partida</p>
            <div className="modal__actions">
              <button className="btn btn--primary" onClick={() => setAbandonedBy(null)}>Continuar</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
