import { useEffect, useRef, useState } from 'react'
import socket from '../socket'

function BoltIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  )
}

// Icono mostrado en el botón mientras un powerup está "armado" (esperando a
// que el jugador toque el dado objetivo). Todos comparten el rayo por ahora;
// cuando haya powerups con icono propio, añadir su entrada aquí.
const POWERUP_ICONS = {
  'powerup-bloqueo': BoltIcon,
}

// Por powerup: cuándo tiene sentido lanzarlo dado el estado actual del turno.
// De momento solo existe "Bloqueo" (reactivo: bloquea un dado del rival, así
// que solo se puede usar en el turno del contrincante y mientras siga
// jugando) — y como mucho una vez por turno del rival, ver bloqueoUsedThisTurn
// (viene del servidor, ver sanitize() en server.js).
const POWERUP_RULES = {
  'powerup-bloqueo': ({ isMyTurn, currentPlayer, bloqueoUsedThisTurn }) =>
    !isMyTurn && !!currentPlayer && !currentPlayer.done && !bloqueoUsedThisTurn,
}

function canUsePowerup(item, ctx) {
  if (!item.quantity) return false
  const rule = POWERUP_RULES[item.id]
  return rule ? rule(ctx) : true
}

// Botón de powerups del HUD de partida — visual idéntico al de emojis
// (waiting-bar__icon-btn), pero despliega hacia arriba el listado de
// powerups del jugador. Solo visible en salas con gameMode 'powerups'.
//
// armedItemId: id del powerup actualmente "armado" (esperando selección de
// dado objetivo) — lo controla el componente padre (GameBoard), que es quien
// sabe qué dado se ha tocado. Mientras está armado el icono parpadea y un
// nuevo toque en el botón cancela el armado en vez de abrir el menú.
export default function PowerupsButton({ isMyTurn, currentPlayer, bloqueoUsedThisTurn = false, armedItemId = null, onActivate, onCancel }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const wrapRef = useRef(null)

  useEffect(() => {
    socket.emit('get_user_items', (res) => {
      if (res?.ok) setItems((res.items ?? []).filter(i => i.category === 'powerup'))
    })
  // Refresca también al resolverse/cancelarse un armado, para reflejar el stock consumido
  }, [armedItemId])

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  function handleTriggerClick() {
    if (armedItemId) { onCancel?.(); return }
    setOpen(v => !v)
  }

  function handleSelect(item) {
    if (!canUsePowerup(item, { isMyTurn, currentPlayer, bloqueoUsedThisTurn })) return
    setOpen(false)
    onActivate?.(item.id)
  }

  const TriggerIcon = armedItemId ? (POWERUP_ICONS[armedItemId] ?? BoltIcon) : BoltIcon

  return (
    <div className="powerups" ref={wrapRef}>
      <button
        type="button"
        className={`waiting-bar__icon-btn${armedItemId ? ' powerups__btn--armed' : ''}`}
        onClick={handleTriggerClick}
        aria-label="Powerups"
      >
        <TriggerIcon />
      </button>
      {open && !armedItemId && (
        <div className="powerups__menu">
          {items.length === 0 ? (
            <p className="powerups__empty">No tienes powerups</p>
          ) : (
            items.map(item => (
              <button
                key={item.id}
                type="button"
                className="powerups__opt"
                disabled={!canUsePowerup(item, { isMyTurn, currentPlayer, bloqueoUsedThisTurn })}
                onClick={() => handleSelect(item)}
              >
                <span>{item.name}</span>
                <span className="powerups__qty">x{item.quantity}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
