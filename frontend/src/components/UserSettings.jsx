import { useState, useRef } from 'react'
import { googleLogout } from '@react-oauth/google'

export default function UserSettings({ user, onBack, onUpdate, onLogout, onDeleteAccount }) {
  const [name, setName] = useState(user?.name || '')
  const [nameSaved, setNameSaved] = useState(false)
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

  function toggleNotifications(checked) {
    setNotifications(checked)
    onUpdate({ notifications: checked })
  }

  function handleLogout() {
    googleLogout()
    onLogout()
  }

  return (
    <div className="screen settings">
      <div className="settings__header">
        <button className="btn-back" onClick={onBack}>← Volver</button>
        <h2 className="settings__title">Mi cuenta</h2>
      </div>

      <div className="settings__avatar-section">
        <div className="settings__avatar-wrap">
          <img
            className="settings__avatar"
            src={user?.picture}
            alt={user?.name}
            referrerPolicy="no-referrer"
          />
          <button
            className="settings__avatar-btn"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Cambiar foto"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handlePictureChange}
        />
        <div className="settings__avatar-info">
          <span className="settings__display-name">{user?.name}</span>
          <span className="settings__email">{user?.email}</span>
        </div>
      </div>

      <div className="settings__body">

        <div className="settings__section">
          <p className="settings__section-title">Perfil</p>
          <div className="settings__row settings__row--col">
            <label className="settings__label">Nombre en partida</label>
            <div className="settings__input-row">
              <input
                className="input"
                value={name}
                maxLength={12}
                onChange={e => { setName(e.target.value); setNameSaved(false) }}
                onKeyDown={e => e.key === 'Enter' && saveName()}
              />
              <button
                className="btn btn--secondary btn--sm"
                onClick={saveName}
                disabled={!name.trim() || name.trim() === user?.name}
              >
                {nameSaved ? 'Guardado' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>

        <div className="settings__section">
          <p className="settings__section-title">Preferencias</p>
          <div className="settings__row">
            <div className="settings__row-info">
              <span className="settings__label">Notificaciones</span>
              <span className="settings__hint">Avisos al inicio de tu turno</span>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={notifications}
                onChange={e => toggleNotifications(e.target.checked)}
              />
              <span className="toggle__track">
                <span className="toggle__thumb" />
              </span>
            </label>
          </div>
        </div>

        <div className="settings__section">
          <p className="settings__section-title">Cuenta</p>
          <div className="settings__account-actions">
            <button className="btn btn--secondary btn--full" onClick={handleLogout}>
              Cerrar sesión
            </button>

            {!confirmDelete ? (
              <button className="btn btn--danger btn--full" onClick={() => setConfirmDelete(true)}>
                Eliminar cuenta
              </button>
            ) : (
              <div className="settings__confirm">
                <p className="settings__confirm-text">Esta acción es irreversible. ¿Seguro que quieres eliminar tu cuenta?</p>
                <div className="settings__confirm-btns">
                  <button className="btn btn--secondary" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                  <button className="btn btn--danger" onClick={onDeleteAccount}>Eliminar</button>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
