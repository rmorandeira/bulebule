import { useState, useRef } from 'react'
import { googleLogout } from '@react-oauth/google'

export default function UserSettings({ user, onBack, onUpdate, onLogout, onDeleteAccount }) {
  const [name, setName]               = useState(user?.name || '')
  const [nameSaved, setNameSaved]     = useState(false)
  const [notifications, setNotifications] = useState(user?.notifications ?? false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileInputRef = useRef()

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

  function handleLogout() {
    googleLogout()
    onLogout()
  }

  return (
    <>
      {/* Avatar row */}
      <div className="us__avatar-row">
        <div className="us__avatar-wrap">
          <img className="us__avatar" src={user?.picture} alt={user?.name} referrerPolicy="no-referrer" />
          <button className="us__avatar-btn" onClick={() => fileInputRef.current?.click()} aria-label="Cambiar foto">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        </div>
        <div className="us__avatar-info">
          <span className="us__name">{user?.name}</span>
          <span className="us__email">{user?.email}</span>
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePictureChange} />

      {/* Name field */}
      <p className="bs__label">NOMBRE EN PARTIDA</p>
      <div className="us__name-row">
        <input className="bs__input" value={name} maxLength={12}
          onChange={e => { setName(e.target.value); setNameSaved(false) }}
          onKeyDown={e => e.key === 'Enter' && saveName()} />
        <button className="us__save-btn" onClick={saveName}
          disabled={!name.trim() || name.trim() === user?.name}>
          {nameSaved ? '✓' : 'Guardar'}
        </button>
      </div>

      {/* Notifications */}
      <div className="bs__private-row">
        <span className="bs__label" style={{ margin: 0 }}>NOTIFICACIONES</span>
        <button type="button" role="switch" aria-checked={notifications}
          className={`bs__toggle${notifications ? ' bs__toggle--on' : ''}`}
          onClick={() => { const next = !notifications; setNotifications(next); onUpdate({ notifications: next }) }} />
      </div>

      {/* Legal */}
      <a className="us__privacy-link" href="/privacidad.html" target="_blank" rel="noopener noreferrer">
        Política de Privacidad
      </a>

      {/* Account actions */}
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
    </>
  )
}
