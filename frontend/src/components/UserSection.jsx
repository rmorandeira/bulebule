import { useState, useEffect, useRef } from 'react'
import { googleLogout } from '@react-oauth/google'
import { Capacitor } from '@capacitor/core'
import socket from '../socket'
import { setTheme, getTheme } from '../theme'
import { imgSrc } from '../utils/imgSrc'
import { APP_VERSION_NAME } from '../version'
import { useTranslation, setLanguage } from '../i18n'

const BACKEND = import.meta.env.VITE_BACKEND_URL || ''

const TIER_COLOR = { Diamante: '#4fc3f7', Oro: '#ffd700', Plata: '#9e9e9e', Bronce: '#cd7f32' }

// Map raw game values to display names
const VALUE_NAMES = { AS: 'Ases', K: 'Reyes', Q: 'Reinas', J: 'Jotas', '8': 'Ochos', '7': 'Sietes' }
function fmtHandDesc(desc) {
  if (!desc) return desc
  return desc.replace(/\b(AS|K|Q|J|8|7)\b/g, v => VALUE_NAMES[v] ?? v)
}

function getPlayerProfile(rollStats, t) {
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
    profile = { emoji: '⚡', title: t('user.profile.caidaTitle'), desc: t('user.profile.caidaDesc', { p1 }) }
  } else if (p3 >= 55) {
    profile = { emoji: '🎯', title: t('user.profile.perfeccionistaTitle'), desc: t('user.profile.perfeccionistaDesc', { p3 }) }
  } else if (p1 >= 35 && p3 >= 35) {
    profile = { emoji: '🎭', title: t('user.profile.impredecibleTitle'), desc: t('user.profile.impredecibleDesc') }
  } else if (p2 >= 45) {
    profile = { emoji: '⚖️', title: t('user.profile.calculadorTitle'), desc: t('user.profile.calculadorDesc', { p2 }) }
  } else {
    profile = { emoji: '🎲', title: t('user.profile.versatilTitle'), desc: t('user.profile.versatilDesc') }
  }

  return { ...profile, p1, p2, p3 }
}

export default function UserSection({ user, onBack, onUpdate, onLogout, onDeleteAccount, embedded = false }) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState('stats')
  const [stats, setStats]         = useState(null)
  const [myRank, setMyRank]       = useState(null)
  const [rankTotal, setRankTotal] = useState(0)
  const [handStats, setHandStats] = useState(null)
  const [rollStats, setRollStats] = useState(null)
  const [reportOpen, setReportOpen]       = useState(false)
  const [reportedPlayer, setReportedPlayer] = useState('')
  const [reportText, setReportText]       = useState('')
  const [reportError, setReportError]     = useState('')
  const [reportSending, setReportSending] = useState(false)
  const [reportSent, setReportSent]       = useState(false)
  const [commentsEnabled, setCommentsEnabled] = useState(true)

  useEffect(() => {
    socket.emit('get_settings', (res) => {
      if (res?.ok) setCommentsEnabled(res.settings?.featureFlags?.comments !== false)
    })
  }, [])

  async function submitReport() {
    if (!reportText.trim()) return setReportError(t('user.settings.reportErrorEmpty'))
    setReportSending(true)
    setReportError('')
    try {
      const res = await fetch(`${BACKEND}/api/report-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reporterName: user?.name ?? null,
          reportedPlayer: reportedPlayer.trim(),
          messageText: reportText.trim(),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || t('user.settings.reportErrorGeneric'))
      setReportSent(true)
      setReportedPlayer('')
      setReportText('')
    } catch (e) {
      setReportError(e.message || t('user.settings.reportErrorGeneric'))
    } finally {
      setReportSending(false)
    }
  }

  const TABS = [
    { id: 'stats',     label: t('user.tabs.stats') },
    { id: 'historial', label: t('user.tabs.historial') },
    { id: 'items',     label: t('user.tabs.items') },
    { id: 'ajustes',   label: t('user.tabs.ajustes') },
  ]

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
          <button className="usec__back" onClick={onBack} aria-label={t('user.back')}>
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
  const { t } = useTranslation()

  if (!stats) {
    return <p className="usec__empty">{t('user.stats.loading')}</p>
  }

  const gamesLost = stats.gamesPlayed - stats.gamesWon
  const winRate   = stats.gamesPlayed > 0
    ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100)
    : 0

  const profile    = getPlayerProfile(rollStats, t)
  const totalHands = handStats?.reduce((s, h) => s + h.count, 0) ?? 0

  return (
    <div className="usec__stats">

      {/* Score hero */}
      <div className="usec__stat-hero">
        <span className="usec__stat-hero-value">{stats.score.toLocaleString()}</span>
        <span className="usec__stat-hero-label">{t('user.stats.bules')}</span>
      </div>

      {/* Summary grid */}
      <div className="usec__stat-grid">
        {myRank && (
          <div className="usec__stat-card">
            <span className="usec__stat-card-value">#{myRank}</span>
            <span className="usec__stat-card-label">{t('user.stats.ofTotal', { total: rankTotal })}</span>
          </div>
        )}
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{stats.gamesPlayed}</span>
          <span className="usec__stat-card-label">{t('user.stats.games')}</span>
        </div>
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{stats.gamesWon}</span>
          <span className="usec__stat-card-label">{t('user.stats.wins')}</span>
        </div>
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{gamesLost}</span>
          <span className="usec__stat-card-label">{t('user.stats.losses')}</span>
        </div>
        <div className="usec__stat-card">
          <span className="usec__stat-card-value">{winRate}%</span>
          <span className="usec__stat-card-label">{t('user.stats.winRate')}</span>
        </div>
      </div>

      {/* Player profile */}
      {profile && (
        <div className="usec__section">
          <p className="usec__section-title">{t('user.stats.profileTitle')}</p>
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
              <span>{t('user.stats.roll1')}</span>
              <span>{t('user.stats.roll2')}</span>
              <span>{t('user.stats.roll3')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Hand stats */}
      {handStats && handStats.length > 0 && (
        <div className="usec__section">
          <p className="usec__section-title">{t('user.stats.handsTitle', { total: totalHands })}</p>
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
        <p className="usec__empty" style={{ marginTop: 8 }}>{t('user.stats.handsEmpty')}</p>
      )}
    </div>
  )
}

// ── Items tab ─────────────────────────────────────────────────────────────────

const CLOSE_DURATION = 260

function ItemsTab({ user }) {
  const { t } = useTranslation()
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

  if (loading) return <p className="usec__empty">{t('common.loading')}</p>

  if (items.length === 0) {
    return (
      <div className="usec__coming-soon">
        <span className="usec__coming-icon">🎁</span>
        <p className="usec__coming-title">{t('user.items.empty')}</p>
        <p className="usec__coming-sub">{t('user.items.emptySub')}</p>
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
              {activeSkin === item.id && <span className="mkt__active-badge">{t('user.items.active')}</span>}
              <span className="mkt__owned-badge">{t('user.items.owned')}</span>
            </div>
            <p className="mkt__card-name">{item.name}</p>
            <p className="mkt__card-price">{item.price === 0 ? t('common.free') : t('user.items.bules', { n: item.price.toLocaleString() })}</p>
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
                {selected.price === 0 ? t('common.free') : t('user.items.bules', { n: selected.price.toLocaleString() })}
              </p>
              {selected.category === 'dice' && (
                activeSkin === selected.id ? (
                  <button className="bs__submit bs__submit--secondary" onClick={handleUnequip}>
                    {t('user.items.unequip')}
                  </button>
                ) : (
                  <button className="bs__submit" onClick={() => handleEquip(selected.id)}>
                    {t('user.items.equip')}
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

function fmtDate(ts, t, lang) {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diffDays = Math.floor((now - d) / 86400000)
  const time = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  if (diffDays === 0) return `${t('user.historial.today')} · ${time}`
  if (diffDays === 1) return `${t('user.historial.yesterday')} · ${time}`
  const locale = lang === 'en' ? 'en-US' : 'es-ES'
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) + ` · ${time}`
}

function HistorialTab() {
  const { t, lang } = useTranslation()
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

  if (loading) return <p className="usec__empty">{t('common.loading')}</p>

  const timeline = [
    ...sessions.map(s => ({ type: 'game', ts: s.played_at, ...s })),
    ...purchases.map(p => ({ type: 'purchase', ts: p.bought_at, ...p })),
  ].sort((a, b) => b.ts - a.ts)

  if (timeline.length === 0) {
    return (
      <div className="usec__coming-soon">
        <span className="usec__coming-icon">📋</span>
        <p className="usec__coming-title">{t('user.historial.empty')}</p>
        <p className="usec__coming-sub">{t('user.historial.emptySub')}</p>
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
              <p className="hist__title">{entry.result === 'win' ? t('user.historial.win') : t('user.historial.loss')}</p>
              <p className="hist__date">{fmtDate(entry.ts, t, lang)}</p>
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
              <p className="hist__date">{fmtDate(entry.ts, t, lang)}</p>
            </div>
            <span className="hist__delta hist__delta--purchase">
              {entry.price === 0 ? t('common.free') : `-${entry.price.toLocaleString()} B`}
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

function fmtAcceptedDate(ts, lang) {
  if (!ts) return null
  const locale = lang === 'en' ? 'en-US' : 'es-ES'
  return new Date(ts * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
}

function SettingsTab({ user, onUpdate, onLogout, onDeleteAccount }) {
  const { t, lang } = useTranslation()
  const [name, setName]               = useState(user?.name || '')
  const [nameSaved, setNameSaved]     = useState(false)
  const [notifications, setNotifications] = useState(user?.notifications ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [theme, setThemeState]        = useState(getTheme)
  const fileInputRef = useRef()

  const THEME_OPTIONS = [
    { value: 'light',  label: t('user.settings.themeLight') },
    { value: 'dark',   label: t('user.settings.themeDark') },
    { value: 'system', label: t('user.settings.themeSystem') },
  ]

  function handleThemeChange(value) {
    setThemeState(value)
    setTheme(value)
  }

  function handleLanguageChange(value) {
    setLanguage(value)
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
          <button className="usec__settings-avatar-btn" onClick={() => fileInputRef.current?.click()} aria-label={t('user.settings.changePictureAria')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePictureChange} />

      <div className="usec__settings-section">
        <p className="usec__settings-label">{t('user.settings.appearance')}</p>
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
        <p className="usec__settings-label">{t('user.settings.language')}</p>
        <div className="usec__theme-seg">
          <button
            className={`usec__theme-btn${lang === 'es' ? ' usec__theme-btn--active' : ''}`}
            onClick={() => handleLanguageChange('es')}
          >
            {t('user.settings.langEs')}
          </button>
          <button
            className={`usec__theme-btn${lang === 'en' ? ' usec__theme-btn--active' : ''}`}
            onClick={() => handleLanguageChange('en')}
          >
            {t('user.settings.langEn')}
          </button>
        </div>
        <p className="us__version-text" style={{ marginTop: 6 }}>{t('user.settings.languageHint')}</p>
      </div>

      <div className="usec__settings-section">
        <p className="usec__settings-label">{t('user.settings.nameLabel')}</p>
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
            {nameSaved ? '✓' : t('user.settings.save')}
          </button>
        </div>
      </div>

      <div className="usec__settings-section">
        <div className="bs__private-row">
          <span className="usec__settings-label" style={{ margin: 0 }}>{t('user.settings.notifications')}</span>
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
        <p className="usec__settings-label">{t('user.settings.legal')}</p>
        <a className="us__privacy-link" href="/privacidad.html" target="_blank" rel="noopener noreferrer">
          {t('user.settings.privacyLink')}
        </a>
        <a className="us__privacy-link" href="/terminos.html" target="_blank" rel="noopener noreferrer">
          {t('user.settings.termsLink')}
        </a>
        <p className="us__version-text" style={{ marginTop: 6 }}>{t('user.settings.rgpdText')}</p>
        {(user?.privacyAcceptedAt || user?.consentAcceptedAt) && (
          <p className="us__version-text">
            {t('user.settings.acceptedOn', {
              date: fmtAcceptedDate(user.privacyAcceptedAt ?? Math.floor(user.consentAcceptedAt / 1000), lang),
            })}
          </p>
        )}
      </div>

      <div className="usec__settings-section">
        <p className="usec__settings-label">{t('user.settings.safety')}</p>
        {!commentsEnabled ? (
          <p className="us__version-text">{t('user.settings.reportDisabled')}</p>
        ) : reportSent ? (
          <p className="us__version-text">{t('user.settings.reportSent')}</p>
        ) : (
          <>
            <button
              type="button"
              className="us__privacy-link"
              onClick={() => setReportOpen(open => !open)}
            >
              {t('user.settings.reportLink')}
            </button>
            {reportOpen && (
              <div className="bs__field" style={{ marginTop: 10 }}>
                <p className="bs__label">{t('user.settings.reportPlayerLabel')}</p>
                <input
                  className="bs__input"
                  placeholder={t('user.settings.reportPlayerPlaceholder')}
                  maxLength={100}
                  value={reportedPlayer}
                  onChange={e => setReportedPlayer(e.target.value)}
                />
                <p className="bs__label" style={{ marginTop: 10 }}>{t('user.settings.reportMessageLabel')}</p>
                <textarea
                  className="bs__input bs__textarea"
                  placeholder={t('user.settings.reportMessagePlaceholder')}
                  maxLength={500}
                  rows={4}
                  value={reportText}
                  onChange={e => { setReportText(e.target.value); setReportError('') }}
                />
                {reportError && <p className="bs__error">{reportError}</p>}
                <button className="bs__submit" onClick={submitReport} disabled={reportSending} style={{ marginTop: 10 }}>
                  {reportSending ? t('user.settings.reportSending') : t('user.settings.reportSubmit')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="usec__settings-section">
        <p className="us__version-text">{t('user.settings.version', { v: APP_VERSION_NAME })}</p>

        <button className="bs__submit bs__submit--secondary" onClick={handleLogout}>
          {t('user.settings.logout')}
        </button>

        {!confirmDelete ? (
          <button className="bs__submit bs__submit--danger" onClick={() => setConfirmDelete(true)}>
            {t('user.settings.deleteAccount')}
          </button>
        ) : (
          <>
            <p className="us__confirm-text">{t('user.settings.deleteConfirm')}</p>
            <div className="us__confirm-row">
              <button className="bs__submit bs__submit--secondary" style={{ flex: 1 }} onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
              <button className="bs__submit bs__submit--danger"    style={{ flex: 1 }} onClick={onDeleteAccount}>{t('user.settings.delete')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
