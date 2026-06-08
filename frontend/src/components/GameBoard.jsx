import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import Die from './Die'
import { playDiceRoll, DICE_ROLL_DURATION_MS } from '../sounds'

const DIE_ANIM_DURATION_MS = 160
const STAGGER_MS = (DICE_ROLL_DURATION_MS - DIE_ANIM_DURATION_MS) / 4 // ~97ms entre dados

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
const needsMotionPermission = () =>
  typeof DeviceMotionEvent !== 'undefined' &&
  typeof DeviceMotionEvent.requestPermission === 'function'

export default function GameBoard({ room, myId, onLeave }) {
  const [discardIndices, setDiscardIndices] = useState([])
  const [fullyDiscardedIndices, setFullyDiscardedIndices] = useState([])
  const [hintDismissed, setHintDismissed] = useState(false)
  const [rollDiscardHistory, setRollDiscardHistory] = useState([])
  const discardTimeoutsRef = useRef([])
  const rollingSnapshotRef = useRef([])
  const [rolling, setRolling] = useState(false)
  const [shakeEnabled, setShakeEnabled] = useState(false)
  const [animatingRollIdx, setAnimatingRollIdx] = useState(null)
  const prevRollStateRef = useRef({ playerIdx: -1, rollCount: 0 })

  const currentPlayer = room.players[room.currentPlayerIndex]
  const isMyTurn = currentPlayer?.id === myId
  const me = room.players.find(p => p.id === myId)
  const maxAllowed = room.maxRolls ?? 3
  const mustPass = isMyTurn && !me?.done && (me?.rollCount ?? 0) >= maxAllowed
  const canRoll = isMyTurn && !me?.done && (me?.rollCount ?? 0) < maxAllowed &&
    ((me?.rollCount ?? 0) === 0 || discardIndices.length > 0)
  // Dice are interactive when it's my turn, I've rolled at least once, and can still roll again
  const diceInteractive = isMyTurn && !me?.done && (me?.rollCount ?? 0) > 0 && !mustPass

  const clearDiscards = useCallback(() => {
    discardTimeoutsRef.current.forEach(clearTimeout)
    discardTimeoutsRef.current = []
    setDiscardIndices([])
    setFullyDiscardedIndices([])
    setHintDismissed(false)
  }, [])

  // Reset discard state on new turn or round
  useEffect(() => {
    rollingSnapshotRef.current = []
    setRolling(false)
    clearDiscards()
    setRollDiscardHistory([])
  }, [room.roundNumber, room.currentPlayerIndex, clearDiscards])

  function handleDiscard(i) {
    setHintDismissed(true)
    setDiscardIndices(prev => prev.includes(i) ? prev : [...prev, i])
    const tid = setTimeout(() => {
      setFullyDiscardedIndices(prev => [...prev, i])
    }, 320)
    discardTimeoutsRef.current.push(tid)
  }

  const handleRoll = useCallback(() => {
    playDiceRoll()
    const diceCount = me?.currentDice?.length ?? 5
    const keptIndices = Array.from({ length: diceCount }, (_, i) => i).filter(i => !discardIndices.includes(i))
    if ((me?.rollCount ?? 0) > 0) {
      setRollDiscardHistory(prev => [...prev, [...discardIndices]])
    }
    rollingSnapshotRef.current = [...discardIndices]
    clearDiscards()
    setRolling(true)
    socket.emit('roll', { keptIndices }, (res) => {
      if (!res?.ok) {
        rollingSnapshotRef.current = []
        setRolling(false)
        if (res?.error) alert(res.error)
      }
    })
  }, [discardIndices, me?.currentDice?.length, clearDiscards])

  function handleStand() {
    socket.emit('stand', (res) => {
      if (!res?.ok && res?.error) alert(res.error)
    })
  }

  function handleNextRound() {
    socket.emit('next_round')
  }

  function handleLeave() {
    socket.emit('leave_room')
    onLeave()
  }

  // Detectar nueva tirada y disparar animación
  useEffect(() => {
    const playerIdx = room.currentPlayerIndex
    const rollCount = (isMyTurn ? me : currentPlayer)?.rollCount ?? 0
    const prev = prevRollStateRef.current

    if (playerIdx !== prev.playerIdx) {
      prevRollStateRef.current = { playerIdx, rollCount: 0 }
    }

    if (rollCount > 0 && rollCount > prevRollStateRef.current.rollCount) {
      prevRollStateRef.current = { playerIdx, rollCount }
      rollingSnapshotRef.current = []
      setRolling(false)
      setAnimatingRollIdx(rollCount - 1)
      const timer = setTimeout(() => setAnimatingRollIdx(null), DICE_ROLL_DURATION_MS + 100)
      return () => clearTimeout(timer)
    }
  }, [room.currentPlayerIndex, me?.rollCount, currentPlayer?.rollCount])

  // Auto-enable shake on Android (no permission needed)
  useEffect(() => {
    if (isMobile() && !needsMotionPermission()) {
      setShakeEnabled(true)
    }
  }, [])

  // Shake detection
  useEffect(() => {
    if (!shakeEnabled || !canRoll || rolling) return

    let lastShake = 0
    const THRESHOLD = 28
    const COOLDOWN = 1200

    function onMotion(e) {
      const g = e.accelerationIncludingGravity
      if (!g) return
      const force = Math.sqrt((g.x || 0) ** 2 + (g.y || 0) ** 2 + (g.z || 0) ** 2)
      const now = Date.now()
      if (force > THRESHOLD && now - lastShake > COOLDOWN) {
        lastShake = now
        handleRoll()
      }
    }

    window.addEventListener('devicemotion', onMotion)
    return () => window.removeEventListener('devicemotion', onMotion)
  }, [shakeEnabled, canRoll, rolling, handleRoll])

  async function enableShakeIOS() {
    try {
      const perm = await DeviceMotionEvent.requestPermission()
      if (perm === 'granted') setShakeEnabled(true)
    } catch {}
  }

  const displayPlayer = isMyTurn ? me : currentPlayer
  const allRolls = displayPlayer
    ? [...displayPlayer.rollHistory, ...(displayPlayer.rollCount > 0 ? [displayPlayer.currentDice] : [])]
    : []

  return (
    <div className="screen game">

      {/* Navbar persistente */}
      <nav className="navbar">
        <button className="navbar__exit" onClick={handleLeave}>← Salir</button>
        <span className="navbar__round">Ronda {room.roundNumber}</span>
      </nav>

      {/* ── Pantalla de resultados ── */}
      {room.phase === 'results' ? (() => {
        const winner = room.players.find(p => p.id === room.roundWinnerId)
        const sorted = [...room.players].sort((a, b) => b.wins - a.wins)
        return (
          <>
            <div className="results__winner">
              <p className="results__winner-label">Ganador</p>
              <h2 className="results__name">{winner?.name}</h2>
              <p className="results__hand">{winner?.hand?.desc}</p>
            </div>

            <div className="results__hands">
              {room.players.map(p => (
                <div key={p.id} className={`results__row ${p.id === room.roundWinnerId ? 'results__row--winner' : ''}`}>
                  <span className="results__player">{p.name}</span>
                  <div className="results__dice">
                    {p.currentDice.map((v, i) => <Die key={i} value={v} small />)}
                  </div>
                  <span className="results__desc">{p.hand?.desc}</span>
                </div>
              ))}
            </div>

            <div className="results__scores">
              <p className="results__scores-title">Clasificación</p>
              {sorted.map((p, i) => (
                <div key={p.id} className="results__score-row">
                  <span className="results__pos">{i + 1}.</span>
                  <span className="results__sname">{p.name}</span>
                  <span className="results__wins">{p.wins} {p.wins === 1 ? 'victoria' : 'victorias'}</span>
                </div>
              ))}
            </div>

            {room.hostId === myId ? (
              <button className="btn btn--primary btn--full" onClick={handleNextRound}>Nueva ronda</button>
            ) : (
              <p className="waiting-label">Esperando al host...</p>
            )}
          </>
        )
      })() : (
      /* ── Pantalla de juego ── */
      <>
        {/* Scoreboard */}
        <div className="scoreboard">
          <p className="scoreboard__title">Clasificación</p>
          {[...room.players]
            .sort((a, b) => b.wins - a.wins)
            .map((p, i) => (
              <div key={p.id} className={`scoreboard__row ${p.id === currentPlayer?.id ? 'scoreboard__row--active' : ''}`}>
                <span className="scoreboard__pos">{i + 1}.</span>
                <span className="scoreboard__name">{p.name}{p.id === myId ? ' (tú)' : ''}</span>
                <div className="scoreboard__dice">
                  {p.currentDice.map((v, j) => <Die key={j} value={v} small />)}
                </div>
                <span className="scoreboard__wins">{p.wins}</span>
              </div>
            ))}
        </div>

        {/* Turn label */}
        {!isMyTurn && (
          <div className="turn-label">Turno de <strong>{currentPlayer?.name}</strong></div>
        )}

        {/* Roll history */}
        <div className="rolls">
          {allRolls.map((dice, rollIdx) => {
            const isCurrentRoll = rollIdx === allRolls.length - 1
            const isInteractive = isCurrentRoll && diceInteractive

            // Base = indices nuevos en esta tirada (tirada 0 = los 5, tirada N = los descartados antes de N)
            // History row = base menos lo que se descartó antes de la tirada siguiente
            // Current row = base completo (todos los nuevos, se puede descartar de ellos)
            const base = !isMyTurn
              ? dice.map((_, i) => i)
              : rollIdx === 0
                ? dice.map((_, i) => i)
                : rollDiscardHistory[rollIdx - 1] ?? []

            const newIndices = (!isMyTurn || isCurrentRoll)
              ? base
              : base.filter(i => !(rollDiscardHistory[rollIdx] ?? []).includes(i))

            return (
              <div key={rollIdx} className="roll">
                <span className="roll__label">Tirada {rollIdx + 1}</span>
                {isInteractive && me?.rollCount > 0 && !hintDismissed && !rolling && (
                  <p className="roll__hint">Toca o desliza un dado para descartarlo</p>
                )}
                <div className="roll__dice">
                  {dice.map((val, origIndex) => {
                    const localIdx = newIndices.indexOf(origIndex)
                    if (localIdx === -1) return null
                    if (fullyDiscardedIndices.includes(origIndex)) return null
                    if (rolling && rollingSnapshotRef.current.includes(origIndex)) return null
                    const isDiscarding = isInteractive && discardIndices.includes(origIndex)
                    return (
                      <Die
                        key={origIndex}
                        value={val}
                        onDiscard={isInteractive && !isDiscarding ? () => handleDiscard(origIndex) : null}
                        discarded={isDiscarding}
                        animDelay={rollIdx === animatingRollIdx ? localIdx * STAGGER_MS : null}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}

          {displayPlayer?.rollCount === 0 && (
            <p className="roll__pending">
              {isMyTurn ? 'Tira los dados para empezar' : `${currentPlayer?.name} aún no ha tirado`}
            </p>
          )}

          {displayPlayer?.done && displayPlayer?.hand && (
            <div className="hand-result">{displayPlayer.hand.desc}</div>
          )}
        </div>

        {/* Actions */}
        <div className="actions">
          {isMyTurn && !me?.done && (
            <>
              {me?.rollCount === 0 && (
                <>
                  <div className="actions__row">
                    <button className="btn btn--primary" onClick={handleRoll} disabled={rolling}>
                      Tirar dados
                    </button>
                    {isMobile() && needsMotionPermission() && !shakeEnabled && (
                      <button className="btn btn--secondary" onClick={enableShakeIOS}>
                        Activar agitar
                      </button>
                    )}
                  </div>
                  {shakeEnabled && canRoll && <p className="shake-hint">Agita el móvil para tirar</p>}
                </>
              )}
              {me?.rollCount > 0 && mustPass && (
                <div className="actions__row">
                  <button className="btn btn--primary" onClick={handleStand} disabled={rolling}>
                    Pasar turno
                  </button>
                </div>
              )}
              {me?.rollCount > 0 && !mustPass && (
                <>
                  <div className="actions__row">
                    <button className="btn btn--secondary" onClick={handleStand}>Plantarse</button>
                    <button className="btn btn--primary" onClick={handleRoll} disabled={rolling || !canRoll}>Tirar dados</button>
                  </div>
                  {shakeEnabled && <p className="shake-hint">Agita el móvil para tirar</p>}
                </>
              )}
            </>
          )}
          {(!isMyTurn || me?.done) && (
            <p className="waiting-label">
              {me?.done ? `Tu mano: ${me?.hand?.desc}` : `Esperando a ${currentPlayer?.name}...`}
            </p>
          )}
        </div>
      </>
      )}
    </div>
  )
}
