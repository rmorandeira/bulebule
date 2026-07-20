import { useState, useEffect, useRef } from 'react'
import { googleLogout } from '@react-oauth/google'
import { Capacitor } from '@capacitor/core'
import socket from '../socket'
import { setTheme, getTheme } from '../theme'
import { imgSrc } from '../utils/imgSrc'

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }

const TABS = [
  { id: 'stats',     label: 'Stats' },
  { id: 'historial', label: 'Historial' },
  { id: 'items',     label: 'Items' },
  { id: 'ajustes',   label: 'Ajustes' },
]

// Map raw game values to display names
const VALUE_NAMES = { AS: 'Ases', K: 'Reyes', Q: 'Reinas', J: 'Jotas', '8': 'Ochos', '7': 'Sietes' }
function fmtHandDesc(desc) {
  if (!desc) return desc
  return desc.replace(/\b(AS|K|Q|J|8|7)\b/g, v => VALUE_NAMES[v] ?? v)
}

function getPlayerProfile(rollStats) {
  if (!rollStats || rollStats.length === 0) return null
  const total = rollStats.reduce((s, r) => s + r.count, 0)
  if (total < 5) return null
  const byRolls = Object.fromEntries(rollStats.map(r => [r.rolls, r.count]))
  const c1 = byRolls[1] ?? 0
  const c2 = byRolls[2] ?? 0
  const c3 = byRolls[3] ?? 0
  const p1 = Math.round(c1 / total * 100)
  const p2 = Math.round(c2 / total * 100)
  const p3 = Math.round(c3 / total * 100)

  let profile
  if (p1 >= 55) {
    profile = { emoji: '⚡', title: 'Jugador de caída', desc: `El ${p1}% de las rondas las juegas a la primera tirada — confías en la suerte` }
  } else if (p3 >= 55) {
    profile = { emoji: '🎯', title: 'Perfeccionista', desc: `Usas las 3 tiradas en el ${p3}% de las rondas — siempre intentas mejorar la mano` }
  } else if (p1 >= 35 && p3 >= 35) {
    profile = { emoji: '🎭', title: 'Jugador impredecible', desc: 'Mezclas caídas y agotamiento de tiradas — difícil de leer' }
  } else if (p2 >= 45) {
    profile = { emoji: '⚖️', title: 'Jugador calculador', desc: `Paras en la segunda tirada el ${p2}% de las veces — buen balance entre riesgo y seguridad` }
  } else {
    profile = { emoji: '🎲', title: 'Jugador versátil', desc: 'Adaptas el número de tiradas a cada situación sin un patrón claro' }
  }

  return { ...profile, p1, p2, p3 }
}

export default function UserSection({ user, onBack, onUpdate, onLogout, onDeleteAccount, embedded = false }) {
  const [activeTab, setActiveTab] = useState('stats')
  const [stats, setStats]         = useState(null)
  const [myRank, setMyRank]       = useState(null)
  const [rankTotal, setRankTotal] = useState(0)
  const [handStats, setHandStats] = useState(null)
  const [rollStats, setRollStats] = useState(null)

  useEffect(() => {
    socket.emit('get_stats', (res) => {
      if (!res?.ok) return
      setStats(res.stats)
      setMyRank(res.myRank)
      setRankTotal(res.total ?? 0)
      setHandStats(res.handStats ?? [])
      setRollStats(res.rollStats ?? [])
    })
  }, [])

  const inner = (
    <>
      {/* Header */}
      <div className="usec__header">
        {!embedded && (
          <button className="usec__back" onClick={onBack} aria-label="Volver">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        )}
        <div className="usec__profile">
          <div className="usec__avatar-wrap">
            <img className="usec__avatar" src={user?.picture} alt={user?.name} referrerPolicy="no-referrer" />
            {stats && (
              <span className="usec__tier-badge" style={{ background: TIER_COLOR[stats.tier] ?? TIER_COLOR.Bronce }}>
                {stats.tier}
              </span>
            )}
          </div>
          <span className="usec__profile-name">{user?.name}</span>
          <span className="usec__profile-email">{user?.email}</span>
        </div>
      </div>

      {/* Segmented control */}
      <div className="usec__seg">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`usec__seg-btn${activeTab === tab.id ? ' usec__seg-btn--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="usec__content">
        {activeTab === 'stats'     && <StatsTab stats={stats} myRank={myRank} rankTotal={rankTotal} handStats={handStats} rollStats={rollStats} />}
        {activeTab === 'historial' && <HistorialTab />}
        {activeTab === 'items'     && <ItemsTab user={user} />}
        {activeTab === 'ajustes'   && (
          <SettingsTab user={user} onUpdate={onUpdate} onLogout={onLogout} onDeleteAccount={onDeleteAccount} />
        )}
      </div>
    </>
  )

  if (embedded) return inner
  return <div className="usec">{inner}</div>
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function StatsTab({ stats, myRank, rankTotal, handStats, rollStats }) {
  if (!stats) {
    return <p className="usec__empty">Cargando estadísticas...</p>
  }

  const gamesLost = stats.gamesPlayed - stats.gamesWon
  const winRate   = stats.gamesPlayed > 0
    ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
    : 0

  const profile    = getPlayerProfile(rollStats)
  const totalHands = handStats?.reduce((s, h) => s + h.count, 0) ?? 0

  return (
    <div className="usec__stats">

      {/* Score hero */}
      <div className="usec__stat-hero">
        <span className="usec__stat-hero-value">{stats.score.toLocaleString()}</span>
        <span className="usec__stat-hero-label">Bules</span>
      </div>

      {/* Summary grid */}
      <div className="usec__stat-grid">
        {myRank && (
          <div className="usec__stat-card">
            <span className="usec__stat-card-value">#{myRank}</span>
            <span className="usec__stat-card-label">de {rankTotal}</span>
          </div>
        )}
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{stats.gamesPlayed}</span>
          <span className="usec__stat-card-label">partidas</span>
        </div>
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{stats.gamesWon}</span>
          <span className="usec__stat-card-label">victorias</span>
        </div>
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{gamesLost}</span>
          <span className="usec__stat-card-label">derrotas</span>
        </div>
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{winRate}%</span>
          <span className="usec__stat-card-label">win rate</span>
        </div>
      </div>

      {/* Player profile */}
      {profile && (
        <div className="usec__section">
          <p className="usec__section-title">PERFIL</p>
          <div className="usec__profile-card">
            <div className="usec__profile-card-top">
              <span className="usec__profile-emoji">{profile.emoji}</span>
              <div>
                <p className="usec__profile-title">{profile.title}</p>
                <p className="usec__profile-desc">{profile.desc}</p>
              </div>
            </div>
            <div className="usec__rolls-bar">
              {profile.p1 > 0 && (
                <div className="usec__rolls-seg usec__rolls-seg--1" style={{ width: `${profile.p1}%` }}>
                  <span className="usec__rolls-seg-label">{profile.p1}%</span>
                </div>
              )}
              {profile.p2 > 0 && (
                <div className="usec__rolls-seg usec__rolls-seg--2" style={{ width: `${profile.p2}%` }}>
                  <span className="usec__rolls-seg-label">{profile.p2}%</span>
                </div>
              )}
              {profile.p3 > 0 && (
                <div className="usec__rolls-seg usec__rolls-seg--3" style={{ width: `${profile.p3}%` }}>
                  <span className="usec__rolls-seg-label">{profile.p3}%</span>
                </div>
              )}
            </div>
            <div className="usec__rolls-legend">
              <span>1 tirada</span>
              <span>2 tiradas</span>
              <span>3 tiradas</span>
            </div>
          </div>
        </div>
      )}

      {/* Hand stats */}
      {handStats && handStats.length > 0 && (
        <div className="usec__section">
          <p className="usec__section-title">JUGADAS ({totalHands} rondas)</p>
          <div className="usec__hand-list">
            {handStats.map((h) => {
              const pct = totalHands > 0 ? Math.round(h.count / totalHands * 100) : 0
              return (
                <div key={h.hand_desc} className="usec__hand-row">
                  <span className="usec__hand-name">{fmtHandDesc(h.hand_desc)}</span>
                  <div className="usec__hand-bar-wrap">
                    <div className="usec__hand-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="usec__hand-count">{h.count}</span>
                  <span className="usec__hand-pct">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {handStats && handStats.length === 0 && (
        <p className="usec__empty" style={{ marginTop: 8 }}>Juega partidas para ver tus estadísticas de jugadas</p>
      )}
    </div>
  )
}

// ── Items tab ─────────────────────────────────────────────────────────────────

const CLOSE_DURATION = 260

function ItemsTab({ user }) {
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [selected, setSelected]     = useState(null)
  const [closing, setClosing]       = useState(false)
  const [activeSkin, setActiveSkin] = useState(() => localStorage.getItem('bule_dice_skin') ?? null)
  const closeRef = useRef(null)

  useEffect(() => {
    socket.emit('get_user_items', (res) => {
      setLoading(false)
      if (res?.ok) setItems(res.items ?? [])
    })
  }, [])

  function openItem(item) {
    clearTimeout(closeRef.current)
    setClosing(false)
    setSelected(item)
  }

  function closeItem() {
    setClosing(true)
    closeRef.current = setTimeout(() => { setSelected(null); setClosing(false) }, CLOSE_DURATION)
  }

  function handleEquip(itemId) {
    localStorage.setItem('bule_dice_skin', itemId)
    setActiveSkin(itemId)
    socket.emit('set_dice_skin', { skinId: itemId })
  }

  function handleUnequip() {
    localStorage.removeItem('bule_dice_skin')
    setActiveSkin(null)
    socket.emit('set_dice_skin', { skinId: null })
  }

  if (loading) return <p className="usec__empty">Cargando...</p>

  if (items.length === 0) {
    return (
      <div className="usec__coming-soon">
        <span className="usec__coming-icon">🎁</span>
        <p className="usec__coming-title">Sin items todavía</p>
        <p className="usec__coming-sub">Compra items en la tienda con tus Bules</p>
      </div>
    )
  }

  return (
    <>
      <div className="mkt__grid mkt__grid--usec">
        {items.map(item => (
          <div key={item.id} className="mkt__card mkt__card--owned" onClick={() => openItem(item)}>
            <div className="mkt__card-img-wrap">
              <img
                className="mkt__card-img"
                src={imgSrc(item.image_url)}
                alt={item.name}
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
              {activeSkin === item.id && <span className="mkt__active-badge">Activo</span>}
              <span className="mkt__owned-badge">Tuyo</span>
            </div>
            <p className="mkt__card-name">{item.name}</p>
            <p className="mkt__card-price">{item.price === 0 ? 'Gratis' : `${item.price.toLocaleString()} Bules`}</p>
          </div>
        ))}
      </div>

      {selected && (
        <>
          <div
            className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`}
            onClick={closeItem}
          />
          <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true">
            <div className="bs__handle" />
            <div className="mkt__sheet">
              <div className="mkt__sheet-img-wrap">
                <img
                  className="mkt__sheet-img"
                  src={imgSrc(selected.image_url)}
                  alt={selected.name}
                  onError={e => { e.currentTarget.style.display = 'none' }}
                />
              </div>
              <p className="mkt__sheet-name">{selected.name}</p>
              {selected.description && (
                <p className="mkt__sheet-desc" dangerouslySetInnerHTML={{ __html: selected.description }} />
              )}
              <p className="mkt__sheet-price">
                {selected.price === 0 ? 'Gratis' : `${selected.price.toLocaleString()} Bules`}
              </p>
              {selected.category === 'dice' && (
                activeSkin === selected.id ? (
                  <button className="bs__submit bs__submit--secondary" onClick={handleUnequip}>
                    Desactivar skin
                  </button>
                ) : (
                  <button className="bs__submit" onClick={() => handleEquip(selected.id)}>
                    Activar skin
                  </button>
                )
              )}
            </div>
          </div>
        </>
      )}
    </>
  )
}

// ── Historial tab ─────────────────────────────────────────────────────────────

function fmtDate(ts) {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  if (diffDays === 0) return `Hoy · ${time}`
  if (diffDays === 1) return `Ayer · ${time}`
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) + ` · ${time}`
}

function HistorialTab() {
  const [sessions, setSessions]   = useState([])
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    socket.emit('get_user_history', (res) => {
      setLoading(false)
      if (res?.ok) {
        setSessions(res.sessions ?? [])
        setPurchases(res.purchases ?? [])
      }
    })
  }, [])

  if (loading) return <p className="usec__empty">Cargando...</p>

  const timeline = [
    ...sessions.map(s => ({ type: 'game', ts: s.played_at, ...s })),
    ...purchases.map(p => ({ type: 'purchase', ts: p.bought_at, ...p })),
  ].sort((a, b) => b.ts - a.ts)

  if (timeline.length === 0) {
    return (
      <div className="usec__coming-soon">
        <span className="usec__coming-icon">📋</span>
        <p className="usec__coming-title">Sin actividad aún</p>
        <p className="usec__coming-sub">Aquí verás tus partidas y compras</p>
      </div>
    )
  }

  return (
    <div className="hist__list">
      {timeline.map((entry, i) => (
        entry.type === 'game' ? (
          <div key={`g${i}`} className={`hist__row hist__row--${entry.result}`}>
            <span className="hist__icon">{entry.result === 'win' ? '🏆' : '💀'}</span>
            <div className="hist__info">
              <p className="hist__title">{entry.result === 'win' ? 'Victoria' : 'Derrota'}</p>
              <p className="hist__date">{fmtDate(entry.ts)}</p>
            </div>
            <span className={`hist__delta hist__delta--${entry.result}`}>
              {entry.result === 'win' ? '+' : ''}{entry.score_delta} B
            </span>
          </div>
        ) : (
          <div key={`p${i}`} className="hist__row hist__row--purchase">
            <img src={imgSrc(entry.image_url)} alt={entry.name} className="hist__item-img"
              onError={e => { e.currentTarget.style.display = 'none' }} />
            <div className="hist__info">
              <p className="hist__title">{entry.name}</p>
              <p className="hist__date">{fmtDate(entry.ts)}</p>
            </div>
            <span className="hist__delta hist__delta--purchase">
              {entry.price === 0 ? 'Gratis' : `-${entry.price.toLocaleString()} B`}
            </span>
          </div>
        )
      ))}
    </div>
  )
}

// ── Coming soon ───────────────────────────────────────────────────────────────

function ComingSoon() {
  return (
    <div className="usec__coming-soon">
      <span className="usec__coming-icon">🚧</span>
      <p className="usec__coming-title">Próximamente</p>
      <p className="usec__coming-sub">Estamos trabajando en ello</p>
    </div>
  )
}

// ── Settings ──────────────────────────────────────────────────────────────────

const THEME_OPTIONS = [
  { value: 'light',  label: 'Claro' },
  { value: 'dark',   label: 'Oscuro' },
  { value: 'system', label: 'Sistema' },
]

function SettingsTab({ user, onUpdate, onLogout, onDeleteAccount }) {
  const [name, setName]               = useState(user?.name || '')
  const [nameSaved, setNameSaved]     = useState(false)
  const [notifications, setNotifications] = useState(user?.notifications ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [theme, setThemeState]        = useState(getTheme)
  const fileInputRef = useRef()

  function handleThemeChange(value) {
    setThemeState(value)
    setTheme(value)
  }

  function saveName() {
    if (!name.trim() || name.trim() === user?.name) return
    onUpdate({ name: name.trim() })
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 2000)
  }

  function handlePictureChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => onUpdate({ picture: ev.target.result })
    reader.readAsDataURL(file)
  }

  async function handleLogout() {
    if (Capacitor.isNativePlatform()) {
      try {
        const { GoogleAuth } = await import('@codetrix-studio/capacitor-google-auth')
        await GoogleAuth.signOut()
      } catch (_) {}
    } else {
      googleLogout()
    }
    onLogout()
  }

  return (
    <div className="usec__settings">
      {/* Avatar */}
      <div className="usec__settings-avatar-row">
        <div className="usec__settings-avatar-wrap">
          <img className="usec__settings-avatar" src={user?.picture} alt={user?.name} referrerPolicy="no-referrer" />
          <button className="usec__settings-avatar-btn" onClick={() => fileInputRef.current?.click()} aria-label="Cambiar foto">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePictureChange} />

      <div className="usec__settings-section">
        <p className="usec__settings-label">APARIENCIA</p>
        <div className="usec__theme-seg">
          {THEME_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`usec__theme-btn${theme === opt.value ? ' usec__theme-btn--active' : ''}`}
              onClick={() => handleThemeChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="usec__settings-section">
        <p className="usec__settings-label">NOMBRE EN PARTIDA</p>
        <div className="usec__settings-name-row">
          <input
            className="bs__input"
            value={name}
            maxLength={12}
            onChange={e => { setName(e.target.value); setNameSaved(false) }}
            onKeyDown={e => e.key === 'Enter' && saveName()}
          />
          <button
            className="us__save-btn"
            onClick={saveName}
            disabled={!name.trim() || name.trim() === user?.name}
          >
            {nameSaved ? '✓' : 'Guardar'}
          </button>
        </div>
      </div>

      <div className="usec__settings-section">
        <div className="bs__private-row">
          <span className="usec__settings-label" style={{ margin: 0 }}>NOTIFICACIONES ACTIVAS</span>
          <button
            type="button"
            role="switch"
            aria-checked={notifications}
            className={`bs__toggle${notifications ? ' bs__toggle--on' : ''}`}
            onClick={() => { const next = !notifications; setNotifications(next); onUpdate({ notifications: next }) }}
          />
        </div>
      </div>

      <div className="usec__settings-section">
        <a className="us__privacy-link" href="/privacidad.html" target="_blank" rel="noopener noreferrer">
          Política de Privacidad
        </a>

        <button className="bs__submit bs__submit--secondary" onClick={handleLogout}>
          Cerrar sesión
        </button>

        {!confirmDelete ? (
          <button className="bs__submit bs__submit--danger" onClick={() => setConfirmDelete(true)}>
            Eliminar cuenta
          </button>
        ) : (
          <>
            <p className="us__confirm-text">Esta acción es irreversible. ¿Seguro?</p>
            <div className="us__confirm-row">
              <button className="bs__submit bs__submit--secondary" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>Cancelar</button>
              <button className="bs__submit bs__submit--danger"    style={{ flex: 1 }} onClick={onDeleteAccount}>Eliminar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
