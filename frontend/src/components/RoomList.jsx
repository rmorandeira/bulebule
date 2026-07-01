import { useState, useEffect, useRef } from 'react'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { GoogleLogin } from '@react-oauth/google'
import { Capacitor } from '@capacitor/core'
import socket from '../socket'
import { track } from '../analytics'
import UserSection from './UserSection'
import TournamentList from './TournamentList'
import Marketplace from './Marketplace'
import TournamentLobby from './TournamentLobby'
import UserDetailSheet from './UserDetailSheet'

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }
const TIER_EMOJI = { Diamante: '💎', Oro: '🥇', Plata: '🥈', Bronce: '🥉' }

function getFavorites() {
  try { return JSON.parse(localStorage.getItem('bule_favorites') ?? '{}') } catch { return {} }
}

function TierDot({ tier }) {
  return <span className="tier-emoji">{TIER_EMOJI[tier] ?? TIER_EMOJI.Bronce}</span>
}

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
  } catch { return null }
}

const MAX_PLAYERS_OPTIONS = [2, 3, 4, 5, 6, 8]
const SOLO_PLAYERS_OPTIONS = [2, 3, 4, 5]
const CLOSE_DURATION = 260

const PAGES = [
  { id: 'clasificacion', emoji: '📊', label: 'Clasificación',  desc: 'Compite en partidas individuales y mejora tu posición en la clasificación mundial' },
  { id: 'challenge',     emoji: '🏆', label: 'Challengue',     desc: 'Reta a otros jugadores en duelos 1vs1 y demuestra quién es el mejor' },
  { id: 'online',        emoji: '🎲', label: 'Juego online',   desc: 'Juega una partida tú sólo o contra la máquina' },
  { id: 'tienda',        emoji: '🎁', label: 'Tienda online',  desc: 'Utiliza tus Bules para comprar objetos y regalos' },
]
const DEFAULT_PAGE = 'online'

const ROOM_STATUS_OPTIONS = [
  { id: 'all',     label: 'Todas' },
  { id: 'lobby',   label: 'Por empezar' },
  { id: 'playing', label: 'En curso' },
]
const ROOM_SORT_OPTIONS = [
  { id: 'default', label: 'Por defecto' },
  { id: 'name',    label: 'Nombre' },
  { id: 'players', label: 'Jugadores' },
]
const DEFAULT_ROOM_FILTER = { sort: 'default', status: 'all', favoritesOnly: false }

function RoomFilterSheet({ filter, onApply, closing, onClose }) {
  const [local, setLocal] = useState(filter)
  const { sheetRef, handleProps } = useSheetDrag(onClose)

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        <p className="bs__label">ESTADO</p>
        <div className="bs__pills">
          {ROOM_STATUS_OPTIONS.map(opt => (
            <button key={opt.id}
              className={`bs__pill${local.status === opt.id ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, status: opt.id }))}>
              {opt.label}
            </button>
          ))}
        </div>

        <p className="bs__label">ORDENAR POR</p>
        <div className="bs__pills">
          {ROOM_SORT_OPTIONS.map(opt => (
            <button key={opt.id}
              className={`bs__pill${local.sort === opt.id ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, sort: opt.id }))}>
              {opt.label}
            </button>
          ))}
        </div>

        <div className="bs__private-row">
          <span className="bs__label" style={{ margin: 0 }}>CON FAVORITOS</span>
          <button type="button" role="switch" aria-checked={local.favoritesOnly}
            className={`bs__toggle${local.favoritesOnly ? ' bs__toggle--on' : ''}`}
            onClick={() => setLocal(v => ({ ...v, favoritesOnly: !v.favoritesOnly }))} />
        </div>

        <button className="bs__submit" onClick={() => { onApply(local); onClose() }}>
          Aplicar filtros
        </button>
        <button className="bs__reset" onClick={() => setLocal(DEFAULT_ROOM_FILTER)}>
          Resetear filtros
        </button>
      </div>
    </>
  )
}

const RANK_SORT_OPTIONS = [
  { id: 'score', label: 'Puntuación' },
  { id: 'name',  label: 'Nombre' },
]
const TIER_OPTIONS = ['Todos', 'Diamante', 'Oro', 'Plata', 'Bronce']
const DEFAULT_RANK_FILTER = { sort: 'score', favoritesOnly: false, tier: 'Todos' }

function FilterSheet({ filter, onApply, closing, onClose }) {
  const [local, setLocal] = useState(filter)
  const { sheetRef, handleProps } = useSheetDrag(onClose)

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        <p className="bs__label">ORDENAR POR</p>
        <div className="bs__pills">
          {RANK_SORT_OPTIONS.map(opt => (
            <button key={opt.id}
              className={`bs__pill${local.sort === opt.id ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, sort: opt.id }))}>
              {opt.label}
            </button>
          ))}
        </div>

        <p className="bs__label">CATEGORÍA</p>
        <div className="bs__pills">
          {TIER_OPTIONS.map(t => (
            <button key={t}
              className={`bs__pill${local.tier === t ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, tier: t }))}>
              {t}
            </button>
          ))}
        </div>

        <div className="bs__private-row">
          <span className="bs__label" style={{ margin: 0 }}>SOLO FAVORITOS</span>
          <button type="button" role="switch" aria-checked={local.favoritesOnly}
            className={`bs__toggle${local.favoritesOnly ? ' bs__toggle--on' : ''}`}
            onClick={() => setLocal(v => ({ ...v, favoritesOnly: !v.favoritesOnly }))} />
        </div>

        <button className="bs__submit" onClick={() => { onApply(local); onClose() }}>
          Aplicar filtros
        </button>
        <button className="bs__reset" onClick={() => setLocal(DEFAULT_RANK_FILTER)}>
          Resetear filtros
        </button>
      </div>
    </>
  )
}

// ── Sheet: crear sala (multijugador + solo play) ─────────────────────────────

function CreateSheet({ user, playerName, onNameChange, closing, onClose }) {
  const { sheetRef, handleProps } = useSheetDrag(onClose)
  const [mode, setMode]             = useState('multi') // 'multi' | 'solo'
  const [guestName, setGuestName]   = useState(playerName || '')
  const [roomName, setRoomName]     = useState('')
  const [maxPlayers, setMaxPlayers] = useState(6)
  const [soloPlayers, setSoloPlayers] = useState(2)
  const [isPrivate, setIsPrivate]   = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (mode === 'multi' && window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus()
    }
  }, [mode])

  const activeName = user ? playerName : guestName

  function create() {
    const name = activeName?.trim()
    if (!name) return setError('Introduce tu nombre primero')
    if (!user) onNameChange?.(name)
    if (mode === 'multi' && !roomName.trim()) return setError('Ponle un nombre a la sala')
    setLoading(true)
    if (mode === 'solo') {
      socket.emit('create_room', {
        playerName: name,
        roomName: 'Solo Play',
        maxPlayers: soloPlayers,
        vsBot: true,
        maxRounds: 0,
        isPrivate: false,
        diceSkin: localStorage.getItem('bule_dice_skin') ?? null,
      }, (res) => {
        setLoading(false)
        if (!res?.ok) return setError(res?.error || 'Error al crear la partida')
        track('room_create', { vsBot: true })
        onClose()
      })
    } else {
      socket.emit('create_room', {
        playerName: name,
        roomName: roomName.trim(),
        maxPlayers,
        vsBot: false,
        maxRounds: 0,
        isPrivate,
        diceSkin: localStorage.getItem('bule_dice_skin') ?? null,
      }, (res) => {
        setLoading(false)
        if (!res?.ok) return setError(res?.error || 'Error al crear la sala')
        track('room_create', { isPrivate })
        onClose()
      })
    }
  }

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        {/* Guest name input */}
        {!user && (
          <div className="bs__field">
            <p className="bs__label">TU NOMBRE</p>
            <input
              className="bs__input"
              placeholder="Tu nombre de jugador"
              value={guestName}
              maxLength={20}
              onChange={e => { setGuestName(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && create()}
            />
          </div>
        )}

        {/* Mode selector */}
        <div className="bs__mode-row">
          <button className={`bs__mode-btn${mode === 'multi' ? ' bs__mode-btn--active' : ''}`}
            onClick={() => { setMode('multi'); setError('') }}>
            Multijugador
          </button>
          <button className={`bs__mode-btn${mode === 'solo' ? ' bs__mode-btn--active' : ''}`}
            onClick={() => { setMode('solo'); setError('') }}>
            Solo Play
          </button>
        </div>

        {/* Multijugador fields — always rendered, collapsed in solo mode */}
        <div className={`bs__collapse${mode === 'multi' ? ' bs__collapse--open' : ''}`}>
          <div className="bs__collapse-inner">
            <p className="bs__label">NOMBRE DE LA SALA</p>
            <input ref={inputRef} className="bs__input" placeholder="Ej: Sala de Roi"
              value={roomName} maxLength={20}
              onChange={e => { setRoomName(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && create()} />
            <div className="bs__private-row">
              <span className="bs__label" style={{ margin: 0 }}>SALA PRIVADA</span>
              <button type="button" role="switch" aria-checked={isPrivate}
                className={`bs__toggle${isPrivate ? ' bs__toggle--on' : ''}`}
                onClick={() => setIsPrivate(v => !v)} />
            </div>
            <p className="bs__label">JUGADORES MÁXIMOS</p>
            <div className="bs__pills">
              {MAX_PLAYERS_OPTIONS.map(n => (
                <button key={n} className={`bs__pill${maxPlayers === n ? ' bs__pill--active' : ''}`}
                  onClick={() => setMaxPlayers(n)}>{n}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Solo play fields — always rendered, collapsed in multi mode */}
        <div className={`bs__collapse${mode === 'solo' ? ' bs__collapse--open' : ''}`}>
          <div className="bs__collapse-inner">
            <p className="bs__label">JUGADORES</p>
            <div className="bs__pills">
              {SOLO_PLAYERS_OPTIONS.map(n => (
                <button key={n} className={`bs__pill${soloPlayers === n ? ' bs__pill--active' : ''}`}
                  onClick={() => setSoloPlayers(n)}>{n}</button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="bs__error">{error}</p>}
        <button className="bs__submit" onClick={create} disabled={loading}>
          {loading ? 'Creando...' : 'Jugar'}
        </button>
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoomList({
  user, playerName, onNameChange, onLogin, onUpdate, onLogout, onDeleteAccount,
  musicOn, onToggleMusic,
}) {
  const [activeTab, setActiveTab]           = useState(DEFAULT_PAGE)
  const [rooms, setRooms]                   = useState([])
  const [roomSearch, setRoomSearch]         = useState('')
  const [rankSearch, setRankSearch]         = useState('')
  const [error, setError]                   = useState('')
  const [joiningCode, setJoiningCode]       = useState(null)
  const [connected, setConnected]           = useState(socket.connected)
  const [codeModal, setCodeModal]           = useState(null)
  const [codeInput, setCodeInput]           = useState('')
  const [codeError, setCodeError]           = useState('')
  const [createSheet, setCreateSheet]       = useState(false)
  const [createClosing, setCreateClosing]   = useState(false)
  const [myStats, setMyStats]   = useState(null)
  const [myRank, setMyRank]     = useState(null)
  const [rankings, setRankings] = useState([])
  const [rankTotal, setRankTotal] = useState(0)
  const [rankFilter, setRankFilter] = useState(DEFAULT_RANK_FILTER)
  const [filterSheet, setFilterSheet]     = useState(false)
  const [filterClosing, setFilterClosing] = useState(false)
  const [roomFilter, setRoomFilter]         = useState(DEFAULT_ROOM_FILTER)
  const [roomFilterSheet, setRoomFilterSheet]     = useState(false)
  const [roomFilterClosing, setRoomFilterClosing] = useState(false)
  const [activeTournament, setActiveTournament] = useState(null)
  const [viewingUser, setViewingUser]           = useState(null) // { userId, name, picture }

  const pagerRef         = useRef(null)
  const scrollTimerRef   = useRef(null)
  const progScrollRef    = useRef(false)
  const closeCreateRef   = useRef(null)
  const closeFilterRef     = useRef(null)
  const closeRoomFilterRef = useRef(null)
  const didInitRef       = useRef(false)
  const prevTabRef       = useRef(activeTab)

  useEffect(() => {
    if (!user && activeTab === 'user') setActiveTab(DEFAULT_PAGE)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // When returning from the user tab, snap the carousel to the active page
  useEffect(() => {
    if (prevTabRef.current === 'user' && activeTab !== 'user') {
      const pager = pagerRef.current
      if (pager) {
        const idx = PAGES.findIndex(p => p.id === activeTab)
        const card = pager.children[idx]
        if (card) pager.scrollLeft = card.offsetLeft - (pager.offsetWidth - card.offsetWidth) / 2
      }
    }
    prevTabRef.current = activeTab
  }, [activeTab])

  function fetchStats() {
    socket.emit('get_stats', (res) => {
      if (!res?.ok) return
      setMyStats(res.stats)
      setMyRank(res.myRank)
      setRankings(res.rankings ?? [])
      setRankTotal(res.total ?? 0)
    })
  }

  useEffect(() => {
    function onConnect() {
      setConnected(true)
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
      fetchStats()
    }
    function onDisconnect() { setConnected(false) }
    function onRoomsList(list) { setRooms(list) }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('rooms_list', onRoomsList)
    if (socket.connected) {
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
      fetchStats()
    }
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('rooms_list', onRoomsList)
      clearTimeout(closeCreateRef.current)
      clearTimeout(closeFilterRef.current)
      clearTimeout(closeRoomFilterRef.current)
      clearTimeout(scrollTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll carousel to default card on mount (no animation)
  useEffect(() => {
    if (didInitRef.current) return
    const pager = pagerRef.current
    if (!pager) return
    const idx = PAGES.findIndex(p => p.id === DEFAULT_PAGE)
    requestAnimationFrame(() => {
      progScrollRef.current = true
      const card = pager.children[idx]
      if (card) pager.scrollLeft = card.offsetLeft - (pager.offsetWidth - card.offsetWidth) / 2
      requestAnimationFrame(() => { progScrollRef.current = false })
    })
    didInitRef.current = true
  }, [])

  // ── Carousel ↔ tab sync ───────────────────────────────────────────────────

  function handlePagerScroll() {
    if (progScrollRef.current) return
    clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      const pager = pagerRef.current
      if (!pager) return
      const center = pager.scrollLeft + pager.offsetWidth / 2
      let closest = 0, minDist = Infinity
      Array.from(pager.children).forEach((card, i) => {
        const dist = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center)
        if (dist < minDist) { minDist = dist; closest = i }
      })
      const page = PAGES[closest]
      if (page && page.id !== activeTab) setActiveTab(page.id)
    }, 150)
  }

  function goToPage(id) {
    const idx = PAGES.findIndex(p => p.id === id)
    if (idx < 0) return
    if (id !== 'challenge') setActiveTournament(null)
    setActiveTab(id)
    const pager = pagerRef.current
    if (!pager) return
    progScrollRef.current = true
    const card = pager.children[idx]
    if (card) pager.scrollTo({ left: card.offsetLeft - (pager.offsetWidth - card.offsetWidth) / 2, behavior: 'smooth' })
    setTimeout(() => { progScrollRef.current = false }, 600)
  }

  // ── Sheets ────────────────────────────────────────────────────────────────

  function openCreate() {
    clearTimeout(closeCreateRef.current)
    setCreateClosing(false)
    setCreateSheet(true)
  }
  function closeCreate() {
    setCreateClosing(true)
    closeCreateRef.current = setTimeout(() => { setCreateSheet(false); setCreateClosing(false) }, CLOSE_DURATION)
  }

  function openFilter() {
    clearTimeout(closeFilterRef.current)
    setFilterClosing(false)
    setFilterSheet(true)
  }
  function closeFilter() {
    setFilterClosing(true)
    closeFilterRef.current = setTimeout(() => { setFilterSheet(false); setFilterClosing(false) }, CLOSE_DURATION)
  }

  function openRoomFilter() {
    clearTimeout(closeRoomFilterRef.current)
    setRoomFilterClosing(false)
    setRoomFilterSheet(true)
  }
  function closeRoomFilter() {
    setRoomFilterClosing(true)
    closeRoomFilterRef.current = setTimeout(() => { setRoomFilterSheet(false); setRoomFilterClosing(false) }, CLOSE_DURATION)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function handleGoogleSuccess(credentialResponse) {
    const payload = decodeJwt(credentialResponse.credential)
    if (!payload) return setError('Error al iniciar sesión con Google')
    onLogin({ name: payload.name, email: payload.email, picture: payload.picture, googleId: payload.sub, idToken: credentialResponse.credential })
    setError('')
  }

  async function handleNativeGoogleLogin() {
    try {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
      try { await GoogleAuth.signOut() } catch (_) {}
      const user = await GoogleAuth.signIn()
      onLogin({ name: user.name, email: user.email, picture: user.imageUrl, googleId: user.id, idToken: user.authentication?.idToken })
      setError('')
    } catch (e) {
      console.error('[GoogleAuth] signIn error:', e)
      setError('Error: ' + (e?.message || e?.error || JSON.stringify(e) || 'desconocido'))
    }
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  function join(code) {
    if (!connected) return setError('Sin conexión al servidor')
    if (!playerName?.trim()) return setError('Introduce tu nombre primero')
    setJoiningCode(code)
    socket.emit('join_room', { code, playerName: playerName.trim(), diceSkin: localStorage.getItem('bule_dice_skin') ?? null }, (res) => {
      setJoiningCode(null)
      if (!res?.ok) return setError(res?.error || 'No se pudo unir a la sala')
      track('room_join')
    })
  }

  function handleJoinClick(room) {
    if (room.isPrivate) { setCodeModal(room); setCodeInput(''); setCodeError('') }
    else join(room.code)
  }

  function joinByCode() {
    const entered = codeInput.trim().toUpperCase()
    if (entered !== codeModal.code) { setCodeError('Código incorrecto'); return }
    setCodeModal(null)
    join(codeModal.code)
  }

  const isFull = r => r.playerCount >= r.maxPlayers

  const favs = rankFilter.favoritesOnly ? getFavorites() : null
  let filteredRankings = rankings
    .filter(r => !rankSearch.trim() || r.name.toLowerCase().includes(rankSearch.trim().toLowerCase()))
    .filter(r => !favs || !!favs[r.userId])
    .filter(r => rankFilter.tier === 'Todos' || r.tier === rankFilter.tier)
  if (rankFilter.sort === 'name') {
    filteredRankings = [...filteredRankings].sort((a, b) => a.name.localeCompare(b.name))
  }
  const isFilterActive = rankFilter.sort !== 'score' || rankFilter.favoritesOnly || rankFilter.tier !== 'Todos'

  const roomFavs = roomFilter.favoritesOnly ? getFavorites() : null
  let filteredRooms = rooms
    .filter(r => !roomSearch.trim() || r.name.toLowerCase().includes(roomSearch.trim().toLowerCase()))
    .filter(r => roomFilter.status === 'all' || (roomFilter.status === 'lobby' ? r.phase === 'lobby' : r.phase !== 'lobby'))
    .filter(r => !roomFavs || (r.playerIds ?? []).some(id => !!roomFavs[id]))
  if (roomFilter.sort === 'name') {
    filteredRooms = [...filteredRooms].sort((a, b) => a.name.localeCompare(b.name))
  } else if (roomFilter.sort === 'players') {
    filteredRooms = [...filteredRooms].sort((a, b) => b.playerCount - a.playerCount)
  }
  const isRoomFilterActive = roomFilter.sort !== 'default' || roomFilter.status !== 'all' || roomFilter.favoritesOnly

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rl">

      {/* Header */}
      <header className="rl__header">
        <div className="rl__hd-left">
          <div className="rl__hd-name-row">
            <span className="rl__hd-name">{user?.name || playerName}</span>
            {myStats && <TierDot tier={myStats.tier} />}
            {!connected && <span className="rl__offline">off</span>}
          </div>
          {myStats && <span className="rl__hd-pts">{myStats.score.toLocaleString()} B</span>}
          {myRank && <span className="rl__hd-rank">Ranking {myRank}/{rankTotal}</span>}
        </div>
        <img className="rl__logo" src="/assets/logo-bulebule.png" alt="Bule Bule" draggable={false} />
        <button className="rl__hd-music" onClick={onToggleMusic} aria-label={musicOn ? 'Silenciar música' : 'Activar música'}>
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
      </header>

      {/* Horizontal card carousel — peek mode (hidden on user tab) */}
      {activeTab !== 'user' && (
        <>
          <div className="rl__carousel" ref={pagerRef} onScroll={handlePagerScroll}>
            {PAGES.map(page => (
              <div key={page.id}
                className={`rl__card${activeTab === page.id ? ' rl__card--active' : ''}`}
                onClick={() => goToPage(page.id)}>
                <span className="rl__card-emoji">{page.emoji}</span>
                <span className="rl__card-label">{page.label}</span>
                <span className="rl__card-desc">{page.desc}</span>
              </div>
            ))}
          </div>
          <div className="rl__divider" />
        </>
      )}

      {/* Content area */}
      <div className="rl__content">

        {/* ── Clasificación ── */}
        {activeTab === 'clasificacion' && (
          <>
            <div className="rl__toolbar">
              <div className="rl__search-wrap">
                <svg className="rl__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input className="rl__search" placeholder="Buscar jugador"
                  value={rankSearch}
                  onChange={e => setRankSearch(e.target.value)} />
                {rankSearch && (
                  <button className="rl__search-clear" onClick={() => setRankSearch('')} aria-label="Borrar búsqueda">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              <button className={`rl__icon-btn${isFilterActive ? ' rl__icon-btn--active' : ''}`} aria-label="Filtrar" onClick={openFilter}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
              </button>
            </div>
            {filteredRankings.length === 0 ? (
              <p className="rl__empty">
                {rankSearch ? 'No se encontró ningún jugador' : 'Juega partidas para aparecer en la clasificación'}
              </p>
            ) : filteredRankings.map(r => (
              <div
                key={r.userId}
                className={`rl__rank-row${r.userId === user?.email ? ' rl__rank-row--me' : ''}`}
                onClick={() => setViewingUser({ userId: r.userId, name: r.name, picture: r.picture })}
              >
                <span className="rl__rank-pos">{r.rank}</span>
                <span className="rl__rank-name">
                  {getFavorites()[r.userId] && <span className="rl__fav-star">★</span>}
                  {r.name}<TierDot tier={r.tier} />
                  {r.isPlaying && <span className="rl__playing-pill">jugando</span>}
                  {r.userId === user?.email && <span className="rl__you-pill">tú</span>}
                </span>
                <span className="rl__rank-score">{r.score.toLocaleString()}</span>
              </div>
            ))}
          </>
        )}

        {/* ── Juego online ── */}
        {activeTab === 'online' && (
          <>
            {error && <p className="rl__error">{error}</p>}
            {!user && (
              <div className="rl__login-row">
                {Capacitor.isNativePlatform() ? (
                  <button className="btn btn--google" onClick={handleNativeGoogleLogin}>
                    <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    Iniciar sesión con Google
                  </button>
                ) : (
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={() => setError('Error al iniciar sesión con Google')}
                    shape="pill" size="medium" text="signin_with" locale="es"
                  />
                )}
              </div>
            )}
            <div className="rl__toolbar">
              <div className="rl__search-wrap">
                <svg className="rl__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input className="rl__search" placeholder="Buscar sala"
                  value={roomSearch}
                  onChange={e => setRoomSearch(e.target.value)} />
                {roomSearch && (
                  <button className="rl__search-clear" onClick={() => setRoomSearch('')} aria-label="Borrar búsqueda">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              <button className={`rl__icon-btn${isRoomFilterActive ? ' rl__icon-btn--active' : ''}`} aria-label="Filtrar" onClick={openRoomFilter}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
              </button>
            </div>
            <div className="rl__rooms">
              {filteredRooms.length === 0 ? (
                <p className="rl__empty">
                  {roomSearch ? 'No se encontró ninguna sala' : 'No hay partidas abiertas ahora mismo'}
                </p>
              ) : filteredRooms.map(room => {
                const canJoin = room.phase === 'lobby' && !isFull(room)
                return (
                  <div key={room.code} className="rl__room">
                    <div className="rl__room-info">
                      <span className="rl__room-name">
                        {room.name}
                        {room.isChallenge ? (
                          <svg className="rl__lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/>
                            <line x1="13" y1="19" x2="19" y2="13"/>
                            <line x1="16" y1="16" x2="20" y2="20"/>
                            <line x1="19" y1="21" x2="21" y2="19"/>
                            <polyline points="9.5 6.5 6 3 3 3 3 6 6.5 9.5"/>
                            <line x1="5" y1="11" x2="11" y2="5"/>
                            <line x1="8" y1="8" x2="4" y2="4"/>
                          </svg>
                        ) : room.isPrivate ? (
                          <svg className="rl__lock" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          </svg>
                        ) : null}
                      </span>
                      <span className="rl__room-meta">
                        {room.playerCount} / {room.maxPlayers} Jugadores
                        {!canJoin && <span className="rl__room-status">{isFull(room) ? ' · Llena' : ' · En curso'}</span>}
                      </span>
                    </div>
                    <button className="rl__join-btn"
                      onClick={() => handleJoinClick(room)}
                      disabled={!canJoin || joiningCode !== null || !connected}>
                      {joiningCode === room.code ? '...' : 'Unirse'}
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── Challenge ── */}
        {activeTab === 'challenge' && (
          activeTournament ? (
            <TournamentLobby
              tournament={activeTournament}
              user={user}
              playerName={playerName}
              onBack={() => setActiveTournament(null)}
              onViewUser={setViewingUser}
            />
          ) : (
            <TournamentList
              user={user}
              myStats={myStats}
              onEnter={setActiveTournament}
            />
          )
        )}

        {/* ── Tienda ── */}
        {activeTab === 'tienda' && (
          <Marketplace user={user} />
        )}

        {/* ── Usuario ── */}
        {activeTab === 'user' && user && (
          <UserSection
            embedded
            user={user}
            onUpdate={onUpdate}
            onLogout={onLogout}
            onDeleteAccount={onDeleteAccount}
          />
        )}

      </div>

      {/* Crear sala — full-width bar, only in online tab */}
      {activeTab === 'online' && (
        <div className="rl__create-bar">
          <button className="rl__create-bar-btn" onClick={openCreate} disabled={!connected}>
            Jugar
          </button>
        </div>
      )}

      {/* Navbar */}
      <nav className="rl__navbar">
        {/* Ranking */}
        <button className={`rl__nav-btn${activeTab === 'clasificacion' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('clasificacion')} aria-label="Clasificación">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6"  y1="20" x2="6"  y2="14"/>
          </svg>
        </button>

        {/* Challenge */}
        <button className={`rl__nav-btn${activeTab === 'challenge' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('challenge')} aria-label="Challengue">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2h12v8c0 3.3-2.7 6-6 6s-6-2.7-6-6V2z"/>
            <path d="M6 4 Q2 7 6 10"/>
            <path d="M18 4 Q22 7 18 10"/>
            <line x1="12" y1="16" x2="12" y2="18"/>
            <rect x="8" y="18" width="8" height="2"/>
            <rect x="4" y="20" width="16" height="2"/>
          </svg>
        </button>

        {/* Home — dado */}
        <button className={`rl__nav-btn${activeTab === 'online' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('online')} aria-label="Juego online">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <circle cx="8.5"  cy="8.5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="15.5" cy="8.5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="8.5"  cy="15.5" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>
          </svg>
        </button>

        {/* Shop */}
        <button className={`rl__nav-btn${activeTab === 'tienda' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('tienda')} aria-label="Tienda">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <path d="M16 10a4 4 0 0 1-8 0"/>
          </svg>
        </button>

        {/* User */}
        <button className={`rl__nav-btn${activeTab === 'user' ? ' rl__nav-btn--active' : ''}`}
          aria-label="Usuario"
          onClick={() => user ? setActiveTab('user') : goToPage('online')}>
          {user?.picture ? (
            <img src={user.picture} alt={user.name} referrerPolicy="no-referrer"
              className={`rl__nav-avatar${activeTab === 'user' ? ' rl__nav-avatar--active' : ''}`} />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
          )}
        </button>
      </nav>

      {/* Room filter sheet */}
      {roomFilterSheet && (
        <RoomFilterSheet
          filter={roomFilter}
          onApply={setRoomFilter}
          closing={roomFilterClosing}
          onClose={closeRoomFilter}
        />
      )}

      {/* Rank filter sheet */}
      {filterSheet && (
        <FilterSheet
          filter={rankFilter}
          onApply={setRankFilter}
          closing={filterClosing}
          onClose={closeFilter}
        />
      )}

      {/* Create / Solo play sheet */}
      {createSheet && (
        <CreateSheet user={user} playerName={playerName} onNameChange={onNameChange}
          closing={createClosing} onClose={closeCreate} />
      )}

      {/* User detail sheet */}
      {viewingUser && (
        <UserDetailSheet
          userId={viewingUser.userId}
          initialName={viewingUser.name}
          initialPicture={viewingUser.picture}
          user={user}
          playerName={playerName}
          onClose={() => setViewingUser(null)}
        />
      )}

      {/* Private room code modal */}
      {codeModal && (
        <div className="modal-overlay" onClick={() => setCodeModal(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <h3 className="modal-box__title">Sala privada</h3>
            <p className="modal-box__hint">Introduce el código para unirte a <strong>{codeModal.name}</strong></p>
            <input className="input input--code" maxLength={4} autoFocus value={codeInput}
              onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError('') }}
              onKeyDown={e => e.key === 'Enter' && joinByCode()} placeholder="XXXX" />
            {codeError && <p className="error">{codeError}</p>}
            <div className="modal-box__actions">
              <button className="btn btn--secondary" onClick={() => setCodeModal(null)}>Cancelar</button>
              <button className="btn btn--primary" onClick={joinByCode} disabled={codeInput.trim().length !== 4}>Unirse</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
