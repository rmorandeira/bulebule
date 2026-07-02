import { useState, useEffect, useRef } from 'react'
import socket from '../socket'

// POC de mensajería: reacciones rápidas mostradas mientras se espera al otro jugador
export const QUICK_REACTIONS = ['👍', '😂', '🔥', '😮', '👏']
const WAITING_PANEL_CLOSE_MS = 200

const _audioTap = new Audio('/assets/button_press.mp3')
function playTapSound() { _audioTap.currentTime = 0; _audioTap.play().catch(() => {}) }

function SmileIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <path d="M8 13.5s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9.5" x2="9.01" y2="9.5"/>
      <line x1="15" y1="9.5" x2="15.01" y2="9.5"/>
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-4.8 7.6 8.5 8.5 0 0 1-9.2-1.3L3 21l1.9-4a8.5 8.5 0 0 1 1.3-9.2 8.38 8.38 0 0 1 7.6-4.8h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  )
}

// Barra que se muestra mientras el jugador espera su turno: dos botones que
// despliegan, respectivamente, reacciones rápidas y un campo de texto libre.
export default function WaitingBar({ label }) {
  const [openPanel, setOpenPanel] = useState(null)   // null | 'quick' | 'custom' — objetivo
  const [renderPanel, setRenderPanel] = useState(null) // panel montado (se retrasa en el cierre)
  const [closing, setClosing] = useState(false)
  const [customText, setCustomText] = useState('')
  const closeTimerRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => () => clearTimeout(closeTimerRef.current), [])

  useEffect(() => {
    if (openPanel === 'custom') inputRef.current?.focus()
  }, [openPanel])

  function openPanelFn(panel) {
    clearTimeout(closeTimerRef.current)
    setClosing(false)
    setRenderPanel(panel)
    setOpenPanel(panel)
  }

  function closePanel() {
    setClosing(true)
    setOpenPanel(null)
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setRenderPanel(null)
      setClosing(false)
      setCustomText('')
    }, WAITING_PANEL_CLOSE_MS)
  }

  function sendQuick(emoji) {
    playTapSound()
    socket.emit('send_message', { text: emoji })
    closePanel()
  }

  function sendCustom() {
    const text = customText.trim()
    if (!text) return
    socket.emit('send_message', { text })
    closePanel()
  }

  if (!renderPanel) {
    return (
      <div className="waiting-bar">
        <div className="waiting-bar__row">
          <button type="button" className="waiting-bar__icon-btn" onClick={() => openPanelFn('quick')} aria-label="Mensajes rápidos">
            <SmileIcon />
          </button>
          <p className="waiting-label">{label}</p>
          <button type="button" className="waiting-bar__icon-btn" onClick={() => openPanelFn('custom')} aria-label="Mensaje personalizado">
            <ChatIcon />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="waiting-bar">
      <div className={`waiting-bar__row waiting-bar__panel ${closing ? 'waiting-bar__panel--closing' : `waiting-bar__panel--open-${renderPanel}`}`}>
        {renderPanel === 'quick' ? (
          <>
            <button type="button" className="waiting-bar__icon-btn" onClick={closePanel} aria-label="Cerrar">
              <CloseIcon />
            </button>
            <div className="waiting-bar__quick-list">
              {QUICK_REACTIONS.map(emoji => (
                <button key={emoji} type="button" className="waiting-bar__quick-btn" onClick={() => sendQuick(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              className="waiting-bar__input"
              maxLength={40}
              placeholder="Escribe un mensaje..."
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendCustom() }}
            />
            <button type="button" className="waiting-bar__icon-btn" onClick={closePanel} aria-label="Cerrar">
              <CloseIcon />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
