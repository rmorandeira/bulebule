import { useState, useRef, useEffect } from 'react'
import socket from '../socket'

// Solo visible para cuentas marcadas como "tester" desde el backoffice —
// permite forzar el resultado de la próxima tirada para reproducir bugs sin
// depender del azar. El servidor calcula qué jugadas son alcanzables según
// los dados ya bloqueados (ver tester_hand_options/tester_set_forced_hand
// en backend/server.js) y sigue usando física + banco de semillas reales,
// solo cambia quién decide el valor objetivo de cada dado.
const RANK_LABELS = ['Carta alta', 'Pareja', 'Dobles parejas', 'Trío', 'Escalera', 'Full', 'Póker', 'Repóker']

export default function TesterHandPicker({ forcedHandRank }) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState(null)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function openPicker() {
    setOpen(true)
    setOptions(null)
    setLoading(true)
    socket.emit('tester_hand_options', (res) => {
      setLoading(false)
      setOptions(res?.ok ? res.options : [])
    })
  }

  function pick(rank) {
    socket.emit('tester_set_forced_hand', { rank }, () => {})
    setOpen(false)
  }

  function clear() {
    socket.emit('tester_clear_forced_hand', () => {})
    setOpen(false)
  }

  const armedLabel = forcedHandRank != null ? RANK_LABELS[forcedHandRank] : null

  return (
    <div className="tester-hand" ref={wrapRef}>
      <button
        type="button"
        className={`tester-hand__btn${armedLabel ? ' tester-hand__btn--armed' : ''}`}
        onClick={() => (open ? setOpen(false) : (armedLabel ? setOpen(true) : openPicker()))}
        aria-label="Forzar jugada (tester)"
        title="Forzar jugada (tester)"
      >
        🎯{armedLabel ? ` ${armedLabel}` : ''}
      </button>
      {open && (
        <div className="tester-hand__menu">
          {armedLabel ? (
            <>
              <button type="button" className="tester-hand__opt" onClick={openPicker}>Cambiar</button>
              <button type="button" className="tester-hand__opt tester-hand__opt--danger" onClick={clear}>Quitar</button>
            </>
          ) : loading ? (
            <div className="tester-hand__msg">Cargando…</div>
          ) : options?.length ? (
            options.map(o => (
              <button key={o.rank} type="button" className="tester-hand__opt" onClick={() => pick(o.rank)}>
                {o.name}
              </button>
            ))
          ) : (
            <div className="tester-hand__msg">Sin opciones</div>
          )}
        </div>
      )}
    </div>
  )
}
