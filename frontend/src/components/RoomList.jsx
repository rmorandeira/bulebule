import { useState, useEffect, useRef } from 'react'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { GoogleLogin } from '@react-oauth/google'
import { Capacitor } from '@capacitor/core'
import socket from '../socket'
import { track } from '../analytics'
import { useTranslation } from '../i18n'
import { dismissRoomNotification } from '../utils/push'
import { pushBackHandler } from '../utils/backHandler'
import { openExternal } from '../utils/openExternal'
import UserSection from './UserSection'
import TournamentList from './TournamentList'
import Marketplace from './Marketplace'
import TournamentLobby from './TournamentLobby'
import UserDetailSheet from './UserDetailSheet'
import HowToPlaySheet from './HowToPlaySheet'

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
const CLOSE_DURATION = 260
const BACKEND = import.meta.env.VITE_BACKEND_URL || ''

const PAGE_META = [
  { id: 'clasificacion', emoji: '📊' },
  { id: 'challenge',     emoji: '🏆' },
  { id: 'online',        emoji: '🎲' },
  { id: 'tienda',        emoji: '🎁' },
]
const DEFAULT_PAGE = 'online'

const ROOM_STATUS_OPTIONS = [
  { id: 'all',     labelKey: 'statusAll' },
  { id: 'lobby',   labelKey: 'statusLobby' },
  { id: 'playing', labelKey: 'statusPlaying' },
]
const ROOM_SORT_OPTIONS = [
  { id: 'default', labelKey: 'sortDefault' },
  { id: 'name',    labelKey: 'sortName' },
  { id: 'players', labelKey: 'sortPlayers' },
]
const DEFAULT_ROOM_FILTER = { sort: 'default', status: 'all', favoritesOnly: false }

function RoomFilterSheet({ filter, onApply, closing, onClose }) {
  const { t } = useTranslation()
  const [local, setLocal] = useState(filter)
  const { sheetRef, handleProps } = useSheetDrag(onClose)

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        <p className="bs__label">{t('filters.statusLabel')}</p>
        <div className="bs__pills">
          {ROOM_STATUS_OPTIONS.map(opt => (
            <button key={opt.id}
              className={`bs__pill${local.status === opt.id ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, status: opt.id }))}>
              {t(`filters.${opt.labelKey}`)}
            </button>
          ))}
        </div>

        <p className="bs__label">{t('filters.sortByLabel')}</p>
        <div className="bs__pills">
          {ROOM_SORT_OPTIONS.map(opt => (
            <button key={opt.id}
              className={`bs__pill${local.sort === opt.id ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, sort: opt.id }))}>
              {t(`filters.${opt.labelKey}`)}
            </button>
          ))}
        </div>

        <div className="bs__private-row">
          <span className="bs__label" style={{ margin: 0 }}>{t('filters.favoritesOnlyLabel')}</span>
          <button type="button" role="switch" aria-checked={local.favoritesOnly}
            className={`bs__toggle${local.favoritesOnly ? ' bs__toggle--on' : ''}`}
            onClick={() => setLocal(v => ({ ...v, favoritesOnly: !v.favoritesOnly }))} />
        </div>

        <button className="bs__submit" onClick={() => { onApply(local); onClose() }}>
          {t('filters.apply')}
        </button>
        <button className="bs__reset" onClick={() => setLocal(DEFAULT_ROOM_FILTER)}>
          {t('filters.reset')}
        </button>
      </div>
    </>
  )
}

const RANK_SORT_OPTIONS = [
  { id: 'score', labelKey: 'sortScore' },
  { id: 'name',  labelKey: 'sortName' },
]
// Los tiers (Diamante/Oro/Plata/Bronce) son valores de dominio, no texto de
// UI — se muestran igual en ambos idiomas, como el nombre "Bules".
const TIER_OPTIONS = ['Todos', 'Diamante', 'Oro', 'Plata', 'Bronce']
const DEFAULT_RANK_FILTER = { sort: 'score', favoritesOnly: false, tier: 'Todos', onlineOnly: false }

function FilterSheet({ filter, onApply, closing, onClose }) {
  const { t } = useTranslation()
  const [local, setLocal] = useState(filter)
  const { sheetRef, handleProps } = useSheetDrag(onClose)

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        <p className="bs__label">{t('filters.sortByLabel')}</p>
        <div className="bs__pills">
          {RANK_SORT_OPTIONS.map(opt => (
            <button key={opt.id}
              className={`bs__pill${local.sort === opt.id ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, sort: opt.id }))}>
              {t(`filters.${opt.labelKey}`)}
            </button>
          ))}
        </div>

        <p className="bs__label">{t('filters.categoryLabel')}</p>
        <div className="bs__pills">
          {TIER_OPTIONS.map(tier => (
            <button key={tier}
              className={`bs__pill${local.tier === tier ? ' bs__pill--active' : ''}`}
              onClick={() => setLocal(v => ({ ...v, tier }))}>
              {tier === 'Todos' ? t('filters.tierAll') : tier}
            </button>
          ))}
        </div>

        <div className="bs__private-row">
          <span className="bs__label" style={{ margin: 0 }}>{t('filters.rankFavoritesOnlyLabel')}</span>
          <button type="button" role="switch" aria-checked={local.favoritesOnly}
            className={`bs__toggle${local.favoritesOnly ? ' bs__toggle--on' : ''}`}
            onClick={() => setLocal(v => ({ ...v, favoritesOnly: !v.favoritesOnly }))} />
        </div>

        <div className="bs__private-row">
          <span className="bs__label" style={{ margin: 0 }}>{t('filters.onlineOnlyLabel')}</span>
          <button type="button" role="switch" aria-checked={local.onlineOnly}
            className={`bs__toggle${local.onlineOnly ? ' bs__toggle--on' : ''}`}
            onClick={() => setLocal(v => ({ ...v, onlineOnly: !v.onlineOnly }))} />
        </div>

        <button className="bs__submit" onClick={() => { onApply(local); onClose() }}>
          {t('filters.apply')}
        </button>
        <button className="bs__reset" onClick={() => setLocal(DEFAULT_RANK_FILTER)}>
          {t('filters.reset')}
        </button>
      </div>
    </>
  )
}

// ── Sheet: crear sala (multijugador + solo play) ─────────────────────────────

function CreateSheet({ user, playerName, onNameChange, closing, onClose, maxPlayersLimit, storyModeEnabled = true, powerupsEnabled = true, onSelectStory }) {
  const { t } = useTranslation()
  const { sheetRef, handleProps } = useSheetDrag(onClose)
  const maxPlayersOptions = MAX_PLAYERS_OPTIONS.filter(n => n <= maxPlayersLimit)
  const [mode, setMode]             = useState('multi') // 'multi' | 'solo' | 'story'
  const [guestName, setGuestName]   = useState(playerName || '')
  const [roomName, setRoomName]     = useState('')
  const [maxPlayers, setMaxPlayers] = useState(Math.min(6, maxPlayersLimit))
  const [soloPlayers, setSoloPlayers] = useState(2)
  const [isPrivate, setIsPrivate]   = useState(false)
  const [gameMode, setGameMode]     = useState('classic') // 'classic' | 'powerups'
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (mode === 'multi' && window.matchMedia('(pointer: fine)').matches) {
      inputRef.current?.focus()
    }
  }, [mode])

  useEffect(() => {
    if (!powerupsEnabled) setGameMode('classic')
  }, [powerupsEnabled])

  const activeName = user ? playerName : guestName

  function create() {
    if (mode === 'story') {
      if (!storyModeEnabled) return setError(t('create.storyDisabledError'))
      if (!user) return setError(t('create.loginRequiredError'))
      onSelectStory()
      return
    }
    const name = activeName?.trim()
    if (!name) return setError(t('create.nameRequiredError'))
    if (!user) onNameChange?.(name)
    if (mode === 'multi' && !roomName.trim()) return setError(t('create.roomNameRequiredError'))
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
        gameMode,
      }, (res) => {
        setLoading(false)
        if (!res?.ok) return setError(res?.error || t('create.createGameError'))
        track('room_create', { vsBot: true, gameMode })
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
        gameMode,
      }, (res) => {
        setLoading(false)
        if (!res?.ok) return setError(res?.error || t('create.createRoomError'))
        track('room_create', { isPrivate, gameMode })
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
            <p className="bs__label">{t('create.yourName')}</p>
            <input
              className="bs__input"
              placeholder={t('create.namePlaceholder')}
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
            {t('create.multiplayer')}
          </button>
          <button className={`bs__mode-btn${mode === 'solo' ? ' bs__mode-btn--active' : ''}`}
            onClick={() => { setMode('solo'); setError('') }}>
            {t('create.soloPlay')}
          </button>
          {storyModeEnabled && (
            <button className={`bs__mode-btn${mode === 'story' ? ' bs__mode-btn--active' : ''}`}
              onClick={() => { setMode('story'); setError('') }}>
              {t('create.storyMode')}
            </button>
          )}
        </div>

        {/* Ambos paneles ocupan la misma celda de grid: la altura de la ficha
            queda fija al contenido más alto (Multijugador) y no salta al
            cambiar de modo — solo se alterna la visibilidad. */}
        <div className="bs__mode-panels">
          {/* Multijugador fields — siempre montado, oculto en modo solo */}
          <div className={`bs__collapse${mode === 'multi' ? ' bs__collapse--open' : ''}`}>
            <div className="bs__collapse-inner">
              <p className="bs__label">{t('create.roomNameLabel')}</p>
              <input ref={inputRef} className="bs__input" placeholder={t('create.roomNamePlaceholder')}
                value={roomName} maxLength={20}
                onChange={e => { setRoomName(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && create()} />
              <div className="bs__private-row">
                <span className="bs__label" style={{ margin: 0 }}>{t('create.privateRoom')}</span>
                <button type="button" role="switch" aria-checked={isPrivate}
                  className={`bs__toggle${isPrivate ? ' bs__toggle--on' : ''}`}
                  onClick={() => setIsPrivate(v => !v)} />
              </div>
              <p className="bs__label">{t('create.maxPlayersLabel')}</p>
              <div className="bs__pills">
                {maxPlayersOptions.map(n => (
                  <button key={n} className={`bs__pill${maxPlayers === n ? ' bs__pill--active' : ''}`}
                    onClick={() => setMaxPlayers(n)}>{n}</button>
                ))}
              </div>
              {powerupsEnabled && (
                <>
                  <p className="bs__label">{t('create.gameModeLabel')}</p>
                  <div className="bs__mode-row">
                    <button className={`bs__mode-btn${gameMode === 'classic' ? ' bs__mode-btn--active' : ''}`}
                      onClick={() => setGameMode('classic')}>
                      {t('create.gameModeClassic')}
                    </button>
                    <button className={`bs__mode-btn${gameMode === 'powerups' ? ' bs__mode-btn--active' : ''}`}
                      onClick={() => setGameMode('powerups')}>
                      {t('create.gameModePowerups')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Solo play fields — siempre montado, oculto en otros modos */}
          <div className={`bs__collapse${mode === 'solo' ? ' bs__collapse--open' : ''}`}>
            <div className="bs__collapse-inner">
              <p className="bs__label">{t('create.botsLabel')}</p>
              <div className="bs__pills">
                {maxPlayersOptions.map(n => (
                  <button key={n} className={`bs__pill${soloPlayers === n ? ' bs__pill--active' : ''}`}
                    onClick={() => setSoloPlayers(n)}>{n - 1}</button>
                ))}
              </div>
              {powerupsEnabled && (
                <>
                  <p className="bs__label">{t('create.gameModeLabel')}</p>
                  <div className="bs__mode-row">
                    <button className={`bs__mode-btn${gameMode === 'classic' ? ' bs__mode-btn--active' : ''}`}
                      onClick={() => setGameMode('classic')}>
                      {t('create.gameModeClassic')}
                    </button>
                    <button className={`bs__mode-btn${gameMode === 'powerups' ? ' bs__mode-btn--active' : ''}`}
                      onClick={() => setGameMode('powerups')}>
                      {t('create.gameModePowerups')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Modo Historia — sin campos, solo un aviso; el mapa se ve en su propia pantalla */}
          <div className={`bs__collapse${mode === 'story' ? ' bs__collapse--open' : ''}`}>
            <div className="bs__collapse-inner">
              <p className="bs__feedback-intro">{t('create.storyIntro')}</p>
            </div>
          </div>
        </div>

        {error && <p className="bs__error">{error}</p>}
        <button className="bs__submit" onClick={create} disabled={loading}>
          {loading ? t('create.creating') : mode === 'story' ? t('create.viewMap') : t('createBar.play')}
        </button>
      </div>
    </>
  )
}

// ── Sheet: quejas / sugerencias ───────────────────────────────────────────────

function FeedbackSheet({ closing, onClose, onSent, user }) {
  const { t } = useTranslation()
  const { sheetRef, handleProps } = useSheetDrag(onClose)
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [message, setMessage] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  async function send() {
    if (!message.trim()) return setError(t('feedback.emptyError'))
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${BACKEND}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: (user?.name ?? name).trim(),
          email: (user?.email ?? email).trim(),
          message: message.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || t('feedback.sendErrorGeneric'))
      onSent()
    } catch (e) {
      setError(e.message || t('feedback.sendErrorGeneric'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        <p className="bs__feedback-intro">{t('feedback.intro')}</p>

        {!user && (
          <>
            <div className="bs__field">
              <p className="bs__label">{t('feedback.nameLabel')}</p>
              <input className="bs__input" placeholder={t('feedback.namePlaceholder')} maxLength={100}
                value={name} onChange={e => setName(e.target.value)} />
            </div>

            <div className="bs__field">
              <p className="bs__label">{t('feedback.emailLabel')}</p>
              <input className="bs__input" type="email" placeholder="tu@email.com" maxLength={200}
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </>
        )}

        <div className="bs__field">
          <p className="bs__label">{t('feedback.messageLabel')}</p>
          <textarea className="bs__input bs__textarea" placeholder={t('feedback.messagePlaceholder')}
            maxLength={2000} rows={5}
            value={message} onChange={e => { setMessage(e.target.value); setError('') }} />
        </div>

        {error && <p className="bs__error">{error}</p>}
        <button className="bs__submit" onClick={send} disabled={loading}>
          {loading ? t('feedback.sending') : t('feedback.send')}
        </button>
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RoomList({
  user, playerName, onNameChange, onLogin, onUpdate, onLogout, onDeleteAccount,
  musicOn, onToggleMusic, onEnterStory,
}) {
  const { t, lang } = useTranslation()
  const [consentChecked, setConsentChecked] = useState(false)
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
  const [maxPlayersLimit, setMaxPlayersLimit]   = useState(Math.max(...MAX_PLAYERS_OPTIONS))
  const [featureFlags, setFeatureFlags]         = useState({})
  const PAGES = PAGE_META
    .filter(p => p.id !== 'challenge' || featureFlags.tournaments !== false)
    .filter(p => p.id !== 'tienda'    || featureFlags.marketplace !== false)
    .map(p => ({ ...p, label: t(`pages.${p.id}Label`), desc: t(`pages.${p.id}Desc`) }))
  const [feedbackSheet, setFeedbackSheet]     = useState(false)
  const [feedbackClosing, setFeedbackClosing] = useState(false)
  const [helpSheet, setHelpSheet]     = useState(false)
  const [helpClosing, setHelpClosing] = useState(false)
  const [feedbackToast, setFeedbackToast]     = useState(false)

  const pagerRef         = useRef(null)
  const scrollTimerRef   = useRef(null)
  const progScrollRef    = useRef(false)
  const closeCreateRef   = useRef(null)
  const closeFilterRef     = useRef(null)
  const closeRoomFilterRef = useRef(null)
  const closeFeedbackRef   = useRef(null)
  const feedbackToastRef   = useRef(null)
  const closeHelpRef       = useRef(null)
  const didInitRef       = useRef(false)
  const prevTabRef       = useRef(activeTab)

  useEffect(() => {
    if (!user && activeTab === 'user') setActiveTab(DEFAULT_PAGE)
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  // Al cerrar sesión (o cambiar de cuenta) el rango/medalla de la cuenta
  // anterior no debe quedarse pegado en el header — sin esto se veía el
  // rango de invitado mostrando el del usuario que acaba de salir.
  useEffect(() => {
    if (!user) { setMyStats(null); setMyRank(null); return }
    fetchStats()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'challenge' && featureFlags.tournaments === false) setActiveTab(DEFAULT_PAGE)
    if (activeTab === 'tienda'    && featureFlags.marketplace === false) setActiveTab(DEFAULT_PAGE)
  }, [activeTab, featureFlags])

  // Handler base del gesto de "atrás": cierra lo que haya abierto (ficha,
  // modal, torneo activo) o vuelve a la pestaña por defecto; si ya estamos
  // en la pantalla principal sin nada abierto, deja que se salga de la app.
  useEffect(() => pushBackHandler(() => {
    if (codeModal)        { setCodeModal(null); return true }
    if (viewingUser)      { setViewingUser(null); return true }
    if (createSheet)      { closeCreate(); return true }
    if (filterSheet)      { closeFilter(); return true }
    if (roomFilterSheet)  { closeRoomFilter(); return true }
    if (feedbackSheet)    { closeFeedback(); return true }
    if (helpSheet)        { closeHelp(); return true }
    if (activeTournament) { setActiveTournament(null); return true }
    if (activeTab !== DEFAULT_PAGE) { setActiveTab(DEFAULT_PAGE); return true }
    return false
  }), [codeModal, viewingUser, createSheet, filterSheet, roomFilterSheet, feedbackSheet, helpSheet, activeTournament, activeTab])

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

  function fetchSettings() {
    socket.emit('get_settings', (res) => {
      if (!res?.ok) return
      setMaxPlayersLimit(res.settings?.maxPlayersLimit ?? Math.max(...MAX_PLAYERS_OPTIONS))
      setFeatureFlags(res.settings?.featureFlags ?? {})
    })
  }

  useEffect(() => {
    function onConnect() {
      setConnected(true)
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
      fetchStats()
      fetchSettings()
    }
    function onDisconnect() { setConnected(false) }
    function onRoomsList(list) { setRooms(list) }
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('rooms_list', onRoomsList)
    if (socket.connected) {
      socket.emit('list_rooms', (res) => setRooms(res?.rooms || []))
      fetchStats()
      fetchSettings()
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

  function openHelp() {
    clearTimeout(closeHelpRef.current)
    setHelpClosing(false)
    setHelpSheet(true)
  }
  function closeHelp() {
    setHelpClosing(true)
    closeHelpRef.current = setTimeout(() => { setHelpSheet(false); setHelpClosing(false) }, CLOSE_DURATION)
  }

  // Onboarding: la primera vez que alguien llega a la pantalla principal
  // (con o sin cuenta) le mostramos las reglas del juego automáticamente
  useEffect(() => {
    if (localStorage.getItem('bule_seen_rules')) return
    localStorage.setItem('bule_seen_rules', '1')
    openHelp()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openFeedback() {
    clearTimeout(closeFeedbackRef.current)
    setFeedbackClosing(false)
    setFeedbackSheet(true)
  }
  function closeFeedback() {
    setFeedbackClosing(true)
    closeFeedbackRef.current = setTimeout(() => { setFeedbackSheet(false); setFeedbackClosing(false) }, CLOSE_DURATION)
  }
  function handleFeedbackSent() {
    closeFeedback()
    clearTimeout(feedbackToastRef.current)
    // Esperar a que la ficha termine de cerrarse antes de mostrar el toast
    feedbackToastRef.current = setTimeout(() => {
      setFeedbackToast(true)
      feedbackToastRef.current = setTimeout(() => setFeedbackToast(false), 3000)
    }, CLOSE_DURATION)
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function handleGoogleSuccess(credentialResponse) {
    if (!consentChecked) return setError(t('login.consentRequired'))
    const payload = decodeJwt(credentialResponse.credential)
    if (!payload) return setError(t('login.googleError'))
    onLogin({ name: payload.name, email: payload.email, picture: payload.picture, googleId: payload.sub, idToken: credentialResponse.credential, consentAcceptedAt: Date.now() })
    setError('')
  }

  async function handleNativeGoogleLogin() {
    if (!consentChecked) return setError(t('login.consentRequired'))
    try {
      const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
      try { await GoogleAuth.signOut() } catch (_) {}
      const user = await GoogleAuth.signIn()
      onLogin({ name: user.name, email: user.email, picture: user.imageUrl, googleId: user.id, idToken: user.authentication?.idToken, consentAcceptedAt: Date.now() })
      setError('')
    } catch (e) {
      console.error('[GoogleAuth] signIn error:', e)
      const msg = e?.message || e?.error || ''
      if (e?.code === '12501' || /cancel/i.test(msg)) {
        setError(t('login.signInCancelled'))
      } else {
        setError('Error: ' + (msg || JSON.stringify(e) || 'desconocido'))
      }
    }
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  function join(code) {
    if (!connected) return setError(t('online.noConnection'))
    if (!playerName?.trim()) return setError(t('online.enterNameFirst'))
    setJoiningCode(code)
    socket.emit('join_room', { code, playerName: playerName.trim(), diceSkin: localStorage.getItem('bule_dice_skin') ?? null }, (res) => {
      setJoiningCode(null)
      if (!res?.ok) return setError(res?.error || t('online.joinError'))
      track('room_join')
      dismissRoomNotification(code)
    })
  }

  function handleJoinClick(room) {
    if (room.isPrivate && !room.isChallenge) { setCodeModal(room); setCodeInput(''); setCodeError('') }
    else join(room.code)
  }

  function joinByCode() {
    const entered = codeInput.trim().toUpperCase()
    if (entered !== codeModal.code) { setCodeError(t('roomModal.wrongCode')); return }
    setCodeModal(null)
    join(codeModal.code)
  }

  const isFull = r => r.playerCount >= r.maxPlayers

  const favs = rankFilter.favoritesOnly ? getFavorites() : null
  let filteredRankings = rankings
    .filter(r => !rankSearch.trim() || r.name.toLowerCase().includes(rankSearch.trim().toLowerCase()))
    .filter(r => !favs || !!favs[r.userId])
    .filter(r => rankFilter.tier === 'Todos' || r.tier === rankFilter.tier)
    .filter(r => !rankFilter.onlineOnly || r.online)
  if (rankFilter.sort === 'name') {
    filteredRankings = [...filteredRankings].sort((a, b) => a.name.localeCompare(b.name))
  }
  const isFilterActive = rankFilter.sort !== 'score' || rankFilter.favoritesOnly || rankFilter.tier !== 'Todos' || rankFilter.onlineOnly

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
            <span
              className={`rl__online-dot${connected ? '' : ' rl__online-dot--off'}`}
              title={connected ? t('header.connected') : t('header.disconnected')}
            />
            <span className="rl__hd-name">{user?.name || playerName}</span>
            {myStats && <TierDot tier={myStats.tier} />}
            {!connected && <span className="rl__offline">off</span>}
          </div>
          {myStats && <span className="rl__hd-pts">{myStats.score.toLocaleString()} B</span>}
          {myRank && <span className="rl__hd-rank">{t('header.ranking', { rank: myRank, total: rankTotal })}</span>}
        </div>
        <img className="rl__logo" src="/assets/logo-bulebule.png" alt="Bule Bule" draggable={false} />
        <div className="rl__hd-right">
          <button className="rl__hd-music" onClick={onToggleMusic} aria-label={musicOn ? t('header.muteAria') : t('header.unmuteAria')}>
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
          <button className="rl__hd-music" onClick={openHelp} aria-label="Cómo se juega">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </button>
          <button className="rl__hd-music" onClick={openFeedback} aria-label={t('header.feedbackAria')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            </svg>
          </button>
        </div>
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
                <input className="rl__search" placeholder={t('ranking.searchPlaceholder')}
                  value={rankSearch}
                  onChange={e => setRankSearch(e.target.value)} />
                {rankSearch && (
                  <button className="rl__search-clear" onClick={() => setRankSearch('')} aria-label={t('ranking.searchClearAria')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              <button className={`rl__icon-btn${isFilterActive ? ' rl__icon-btn--active' : ''}`} aria-label={t('ranking.filterAria')} onClick={openFilter}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
              </button>
            </div>
            {filteredRankings.length === 0 ? (
              <p className="rl__empty">
                {rankSearch ? t('ranking.emptySearch') : t('ranking.emptyDefault')}
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
                  {r.online && <span className="rl__online-dot" title={t('ranking.onlineTooltip')} />}
                  {r.name}<TierDot tier={r.tier} />
                  {r.isPlaying && <span className="rl__playing-pill">{t('ranking.playingPill')}</span>}
                  {r.userId === user?.email && <span className="rl__you-pill">{t('ranking.youPill')}</span>}
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
                <label className="rl__consent-row">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={e => { setConsentChecked(e.target.checked); if (e.target.checked) setError('') }}
                  />
                  <span>
                    {t('login.consentPrefix')}{' '}
                    <a href="/privacidad.html" onClick={e => { e.stopPropagation(); e.preventDefault(); openExternal('/privacidad.html') }}>
                      {t('login.privacyLink')}
                    </a>{' '}
                    {t('login.and')}{' '}
                    <a href="/terminos.html" onClick={e => { e.stopPropagation(); e.preventDefault(); openExternal('/terminos.html') }}>
                      {t('login.termsLink')}
                    </a>
                  </span>
                </label>
                {Capacitor.isNativePlatform() ? (
                  <button className="btn btn--google" onClick={handleNativeGoogleLogin} disabled={!consentChecked}>
                    <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    {t('login.googleButton')}
                  </button>
                ) : (
                  <div className={`rl__google-btn-wrap${consentChecked ? '' : ' rl__google-btn-wrap--disabled'}`}>
                    <GoogleLogin
                      onSuccess={handleGoogleSuccess}
                      onError={() => setError(t('login.googleError'))}
                      shape="pill" size="medium" text="signin_with" locale={lang}
                    />
                    {!consentChecked && (
                      <div
                        className="rl__google-btn-overlay"
                        onClick={() => setError(t('login.consentRequired'))}
                      />
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="rl__toolbar">
              <div className="rl__search-wrap">
                <svg className="rl__search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input className="rl__search" placeholder={t('online.searchPlaceholder')}
                  value={roomSearch}
                  onChange={e => setRoomSearch(e.target.value)} />
                {roomSearch && (
                  <button className="rl__search-clear" onClick={() => setRoomSearch('')} aria-label={t('ranking.searchClearAria')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              <button className={`rl__icon-btn${isRoomFilterActive ? ' rl__icon-btn--active' : ''}`} aria-label={t('ranking.filterAria')} onClick={openRoomFilter}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
              </button>
            </div>
            <div className="rl__rooms">
              {filteredRooms.length === 0 ? (
                <p className="rl__empty">
                  {roomSearch ? t('online.emptySearch') : t('online.emptyDefault')}
                </p>
              ) : filteredRooms.map(room => {
                const canJoin = room.phase === 'lobby' && !isFull(room)
                return (
                  <div key={room.code} className="rl__room">
                    {room.isChallenge && <span className="rl__challenge-dot" aria-label={t('online.pendingChallengeAria')} />}
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
                        {room.playerCount} / {room.maxPlayers} {t('online.players')}
                        {!canJoin && <span className="rl__room-status">{isFull(room) ? ` · ${t('online.full')}` : ` · ${t('online.inProgress')}`}</span>}
                      </span>
                    </div>
                    <button className="rl__join-btn"
                      onClick={() => handleJoinClick(room)}
                      disabled={!canJoin || joiningCode !== null || !connected}>
                      {joiningCode === room.code ? '...' : room.isChallenge ? t('online.enter') : t('online.join')}
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
            {t('createBar.play')}
          </button>
        </div>
      )}

      {/* Navbar */}
      <nav className="rl__navbar">
        {/* Ranking */}
        <button className={`rl__nav-btn${activeTab === 'clasificacion' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('clasificacion')} aria-label={t('navbar.ranking')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10"/>
            <line x1="12" y1="20" x2="12" y2="4"/>
            <line x1="6"  y1="20" x2="6"  y2="14"/>
          </svg>
        </button>

        {/* Challenge */}
        {featureFlags.tournaments !== false && (
          <button className={`rl__nav-btn${activeTab === 'challenge' ? ' rl__nav-btn--active' : ''}`}
            onClick={() => goToPage('challenge')} aria-label={t('navbar.challenge')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2h12v8c0 3.3-2.7 6-6 6s-6-2.7-6-6V2z"/>
              <path d="M6 4 Q2 7 6 10"/>
              <path d="M18 4 Q22 7 18 10"/>
              <line x1="12" y1="16" x2="12" y2="18"/>
              <rect x="8" y="18" width="8" height="2"/>
              <rect x="4" y="20" width="16" height="2"/>
            </svg>
          </button>
        )}

        {/* Home — dado */}
        <button className={`rl__nav-btn${activeTab === 'online' ? ' rl__nav-btn--active' : ''}`}
          onClick={() => goToPage('online')} aria-label={t('navbar.online')}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <circle cx="8.5"  cy="8.5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="15.5" cy="8.5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="8.5"  cy="15.5" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none"/>
          </svg>
        </button>

        {/* Shop */}
        {featureFlags.marketplace !== false && (
          <button className={`rl__nav-btn${activeTab === 'tienda' ? ' rl__nav-btn--active' : ''}`}
            onClick={() => goToPage('tienda')} aria-label={t('navbar.shop')}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
          </button>
        )}

        {/* User */}
        <button className={`rl__nav-btn${activeTab === 'user' ? ' rl__nav-btn--active' : ''}`}
          aria-label={t('navbar.user')}
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

      {/* Cómo se juega */}
      {helpSheet && (
        <HowToPlaySheet closing={helpClosing} onClose={closeHelp} />
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
          closing={createClosing} onClose={closeCreate} maxPlayersLimit={maxPlayersLimit}
          storyModeEnabled={featureFlags.storyMode !== false}
          powerupsEnabled={featureFlags.powerups !== false}
          onSelectStory={() => { closeCreate(); onEnterStory() }} />
      )}

      {/* Quejas / sugerencias sheet */}
      {feedbackSheet && (
        <FeedbackSheet closing={feedbackClosing} onClose={closeFeedback} onSent={handleFeedbackSent} user={user} />
      )}

      {feedbackToast && (
        <div className="rl__toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {t('toast.feedbackSent')}
        </div>
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
            <h3 className="modal-box__title">{t('roomModal.title')}</h3>
            <p className="modal-box__hint">{t('roomModal.hintPrefix')} <strong>{codeModal.name}</strong></p>
            <input className="input input--code" maxLength={4} autoFocus value={codeInput}
              onChange={e => { setCodeInput(e.target.value.toUpperCase()); setCodeError('') }}
              onKeyDown={e => e.key === 'Enter' && joinByCode()} placeholder="XXXX" />
            {codeError && <p className="error">{codeError}</p>}
            <div className="modal-box__actions">
              <button className="btn btn--secondary" onClick={() => setCodeModal(null)}>{t('common.cancel')}</button>
              <button className="btn btn--primary" onClick={joinByCode} disabled={codeInput.trim().length !== 4}>{t('roomModal.join')}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
