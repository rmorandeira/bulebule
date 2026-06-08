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
  const [rollDiscardHistory, setRollDiscardHistory] = useState([])
  const [rolling, setRolling] = useState(false)
  const [shakeEnabled, setShakeEnabled] = useState(false)
  const [animatingRollIdx, setAnimatingRollIdx] = useState(null)
  const prevRollStateRef = useRef({ playerIdx: -1, rollCount: 0 })

  const currentPlayer = room.players[room.currentPlayerIndex]
  const isMyTurn = currentPlayer?.id === myId
  const me = room.players.find(p => p.id === myId)
  const maxAllowed = room.maxRolls ?? 3
  const canRoll = isMyTurn && !me?.done && (me?.rollCount ?? 0) < maxAllowed &&
    ((me?.rollCount ?? 0) === 0 || discardIndices.length > 0)
  const mustPass = isMyTurn && !me?.done && (me?.rollCount ?? 0) >= maxAllowed

  // Reset discard state on new turn or round
  useEffect(() => {
    setDiscardIndices([])
    setRollDiscardHistory([])
  }, [room.roundNumber, room.currentPlayerIndex])

  function handleDiscard(i) {
    setDiscardIndices(prev => prev.includes(i) ? prev : [...prev, i])
  }

  const handleRoll = useCallback(() => {
    playDiceRoll()
    const diceCount = me?.currentDice?.length ?? 5
    const keptIndices = Array.from({ length: diceCount }, (_, i) => i).filter(i => !discardIndices.includes(i))
    setRollDiscardHistory(prev => [...prev, [...discardIndices]])
    setDiscardIndices([])
    setRolling(true)
    socket.emit('roll', { keptIndices }, (res) => {
      setRolling(false)
      if (!res?.ok && res?.error) alert(res.error)
    })
  }, [discardIndices, me?.currentDice?.length])

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

  // For history rows (my own turn): only show the freshly rolled dice.
  // Roll 0 always shows all 5 (first roll). Roll N shows indices from rollDiscardHistory[N-1].
  function getDiceToShow(rollIdx, dice, isCurrentRoll) {
    if (isCurrentRoll || rollIdx === 0 || !isMyTurn) {
      return dice.map((value, origIndex) => ({ value, origIndex }))
    }
    const newIndices = rollDiscardHistory[rollIdx - 1] ?? []
    return newIndices.map(i => ({ value: dice[i], origIndex: i }))
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
            const isInteractive = isCurrentRoll && isMyTurn && !me?.done && canRoll
            const diceToShow = getDiceToShow(rollIdx, dice, isCurrentRoll)

            return (
              <div key={rollIdx} className="roll">
                <span className="roll__label">Tirada {rollIdx + 1}</span>
                {isInteractive && me?.rollCount > 0 && discardIndices.length === 0 && (
                  <p className="roll__hint">Desliza hacia abajo para descartar</p>
                )}
                <div className="roll__dice">
                  {diceToShow.map(({ value, origIndex }, localIdx) => (
                    <Die
                      key={origIndex}
                      value={value}
                      onDiscard={isInteractive && !discardIndices.includes(origIndex) ? () => handleDiscard(origIndex) : null}
                      discarded={isInteractive && discardIndices.includes(origIndex)}
                      animDelay={rollIdx === animatingRollIdx ? localIdx * STAGGER_MS : null}
                    />
                  ))}
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
