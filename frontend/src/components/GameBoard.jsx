import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import Die from './Die'
import DiceBoxScene from './DiceBoxScene'
import AlaCaidaToast from './AlaCaidaToast'

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
const needsMotionPermission = () =>
  typeof DeviceMotionEvent !== 'undefined' &&
  typeof DeviceMotionEvent.requestPermission === 'function'

const ROLL_NAMES = ['uno', 'dos', 'tres', 'cuatro', 'cinco']

export default function GameBoard({ room, myId, onLeave }) {
  const [keptIndices, setKeptIndices] = useState([])
  const [rolling, setRolling] = useState(false)
  const [diceAnimating, setDiceAnimating] = useState(false)
  const [shakeEnabled, setShakeEnabled] = useState(false)
  const [showAlaCaida, setShowAlaCaida] = useState(false)
  const [botDisplayedKept, setBotDisplayedKept] = useState([])
  const [timeLeft, setTimeLeft] = useState(null)
  const prevRollStateRef = useRef({ playerIdx: -1, rollCount: 0 })
  const prevDoneRef = useRef({})
  const botReadyTimerRef = useRef(null)

  const currentPlayer = room.players[room.currentPlayerIndex]
  const isMyTurn = currentPlayer?.id === myId
  const me = room.players.find(p => p.id === myId)
  const maxAllowed = room.maxRolls ?? 3
  const mustPass = isMyTurn && !me?.done && (me?.rollCount ?? 0) >= maxAllowed
  const allDiceKept = isMyTurn && (me?.rollCount ?? 0) > 0 && keptIndices.length >= (me?.currentDice?.length ?? 5)
  const canRoll = isMyTurn && !me?.done && (me?.rollCount ?? 0) < maxAllowed && !rolling && !allDiceKept
  const diceInteractive = isMyTurn && !me?.done && !mustPass && (me?.rollCount ?? 0) > 0

  // Reset al cambiar de turno o ronda
  useEffect(() => {
    setKeptIndices([])
    setRolling(false)
  }, [room.roundNumber, room.currentPlayerIndex])

  // Sincronizar rollCount del servidor
  useEffect(() => {
    const playerIdx = room.currentPlayerIndex
    const rollCount = (isMyTurn ? me : currentPlayer)?.rollCount ?? 0
    const prev = prevRollStateRef.current
    if (playerIdx !== prev.playerIdx) {
      prevRollStateRef.current = { playerIdx, rollCount: 0 }
    }
    if (rollCount > 0 && rollCount > prevRollStateRef.current.rollCount) {
      prevRollStateRef.current = { playerIdx, rollCount }
    }
  }, [room.currentPlayerIndex, me?.rollCount, currentPlayer?.rollCount, isMyTurn, me, currentPlayer])

  function handleKeep(i) {
    setKeptIndices(prev => prev.includes(i) ? prev : [...prev, i])
  }

  function handleUnkeep(i) {
    setKeptIndices(prev => prev.filter(idx => idx !== i))
  }

  const handleRoll = useCallback(() => {
    const currentKept = keptIndices
    setKeptIndices([])
    setRolling(true)
    socket.emit('roll', { keptIndices: currentKept }, (res) => {
      if (!res?.ok) {
        setRolling(false)
        if (res?.error) alert(res.error)
      }
    })
  }, [keptIndices])

  function handleStand() {
    socket.emit('stand', (res) => {
      if (!res?.ok && res?.error) alert(res.error)
    })
  }

  function handleNextRound() { socket.emit('next_round') }

  function handleLeave() {
    socket.emit('leave_room')
    onLeave()
  }

  // Shake
  useEffect(() => {
    if (isMobile() && !needsMotionPermission()) setShakeEnabled(true)
  }, [])

  useEffect(() => {
    if (!shakeEnabled || !canRoll) return
    let lastShake = 0
    function onMotion(e) {
      const g = e.accelerationIncludingGravity
      if (!g) return
      const force = Math.sqrt((g.x || 0) ** 2 + (g.y || 0) ** 2 + (g.z || 0) ** 2)
      const now = Date.now()
      if (force > 28 && now - lastShake > 1200) { lastShake = now; handleRoll() }
    }
    window.addEventListener('devicemotion', onMotion)
    return () => window.removeEventListener('devicemotion', onMotion)
  }, [shakeEnabled, canRoll, handleRoll])

  async function enableShakeIOS() {
    try {
      const perm = await DeviceMotionEvent.requestPermission()
      if (perm === 'granted') setShakeEnabled(true)
    } catch {}
  }

  // Detectar "a la caida": solo el PRIMER jugador de la ronda que se planta con 1 tirada
  const playerDoneKey = room.players.map(p => `${p.id}:${p.done}:${p.rollCount}`).join('|')
  useEffect(() => {
    const noneWereDone = Object.values(prevDoneRef.current).every(done => !done)
    room.players.forEach(p => {
      const wasNotDone = !prevDoneRef.current[p.id]
      if (p.done && wasNotDone && p.rollCount === 1 && noneWereDone) {
        setShowAlaCaida(true)
      }
    })
    const next = {}
    room.players.forEach(p => { next[p.id] = p.done })
    prevDoneRef.current = next
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerDoneKey])

  // Bot timing: emit bot_ready once animations finish + 100ms
  const botPhase = room.botPhase
  useEffect(() => {
    clearTimeout(botReadyTimerRef.current)
    setBotDisplayedKept([])

    if (!botPhase) return

    if (botPhase === 'rolled') {
      if (diceAnimating || showAlaCaida) return  // wait — effect will re-run when these change
      botReadyTimerRef.current = setTimeout(() => {
        socket.emit('bot_ready')
      }, 100)
      return () => clearTimeout(botReadyTimerRef.current)
    }

    if (botPhase === 'picking') {
      const indices = room.botKeptIndices ?? []
      let i = 0
      const showNext = () => {
        if (i < indices.length) {
          setBotDisplayedKept(prev => [...prev, indices[i]])
          i++
          botReadyTimerRef.current = setTimeout(showNext, 100)
        } else {
          botReadyTimerRef.current = setTimeout(() => {
            socket.emit('bot_ready')
          }, 100)
        }
      }
      botReadyTimerRef.current = setTimeout(showNext, 100)
      return () => clearTimeout(botReadyTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botPhase, diceAnimating, showAlaCaida])

  // Turn countdown
  useEffect(() => {
    if (!room.turnDeadline || !isMyTurn) { setTimeLeft(null); return }
    const update = () => setTimeLeft(Math.max(0, Math.ceil((room.turnDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [room.turnDeadline, isMyTurn])

  function handleRematch() { socket.emit('rematch') }

  const displayPlayer = isMyTurn ? me : currentPlayer
  const totalDice = displayPlayer?.currentDice?.length || 5
  const nextRollName = ROLL_NAMES[me?.rollCount ?? 0]

  return (
    <div className="screen game">

      <nav className="navbar">
        <button className="navbar__exit" onClick={handleLeave}>← Salir</button>
        <span className="navbar__round">
          Ronda {room.roundNumber}{room.maxRounds > 0 ? ` / ${room.maxRounds}` : ''}
        </span>
      </nav>

      {/* ── Fin de partida ── */}
      {room.phase === 'finished' ? (() => {
        const sorted = [...room.players].sort((a, b) => b.wins - a.wins)
        const champion = sorted[0]
        return (
          <>
            <div className="results__winner">
              <p className="results__winner-label">Campeón de la partida</p>
              <h2 className="results__name">{champion?.name}</h2>
              <p className="results__hand">{champion?.wins} victorias</p>
            </div>
            <div className="results__scores">
              <p className="results__scores-title">Clasificación final</p>
              {sorted.map((p, i) => (
                <div key={p.id} className="results__score-row">
                  <span className="results__pos">{i + 1}.</span>
                  <span className="results__sname">{p.name}</span>
                  <span className="results__wins">{p.wins} {p.wins === 1 ? 'victoria' : 'victorias'}</span>
                </div>
              ))}
            </div>
            {room.hostId === myId
              ? <button className="btn btn--primary btn--full" onClick={handleRematch}>Revancha</button>
              : <p className="waiting-label">Esperando al host...</p>
            }
          </>
        )
      })() : room.phase === 'results' ? (() => {
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
            {room.hostId === myId
              ? <button className="btn btn--primary btn--full" onClick={handleNextRound}>Nueva ronda</button>
              : <p className="waiting-label">Esperando al host...</p>
            }
          </>
        )
      })() : (
      /* ── Juego ── */
      <>
        {/* Scoreboard — sin dados hasta que hayan tirado */}
        <div className="scoreboard">
          <p className="scoreboard__title">Clasificación</p>
          {[...room.players]
            .sort((a, b) => b.wins - a.wins)
            .map((p, i) => (
              <div key={p.id} className={`scoreboard__row ${p.id === currentPlayer?.id ? 'scoreboard__row--active' : ''}`}>
                <span className="scoreboard__pos">{i + 1}.</span>
                <span className="scoreboard__name">{p.name}{p.id === myId ? ' (tú)' : ''}</span>
                {p.currentDice?.length > 0 && (
                  <div className="scoreboard__dice">
                    {p.currentDice.map((v, j) => <Die key={j} value={v} small />)}
                  </div>
                )}
                <span className="scoreboard__wins">{p.wins}</span>
              </div>
            ))}
        </div>

        {!isMyTurn && (
          <div className="turn-label">Turno de <strong>{currentPlayer?.name}</strong></div>
        )}

        {/* ── Tapete + Tu jugada ── */}
        <div className="roll3d-wrapper">

          {/* Etiqueta de tirada actual (solo tras la primera) */}
          {(displayPlayer?.rollCount ?? 0) > 0 && (
            <span className="roll__label">Tirada {displayPlayer.rollCount}</span>
          )}

          {/* Tapete 3D — siempre visible (se inicializa antes del primer roll) */}
          <DiceBoxScene
            dice={displayPlayer?.currentDice ?? []}
            keptIndices={isMyTurn ? keptIndices : []}
            interactive={diceInteractive}
            rolling={rolling}
            onKeep={handleKeep}
            onRollStart={() => setDiceAnimating(true)}
            onSettled={() => { setRolling(false); setDiceAnimating(false) }}
          />

          {/* Tu jugada */}
          {isMyTurn && (
            <div className="my-play">
              <div className="my-play__header">
                <span className="my-play__title">Tu jugada</span>
                {!mustPass && nextRollName && (
                  <span className="my-play__next">Tirada {nextRollName}</span>
                )}
              </div>

              <div className="my-play__dice">
                {Array.from({ length: totalDice }).map((_, slot) => {
                  const originalIndex = keptIndices[slot]
                  if (originalIndex !== undefined && displayPlayer?.currentDice?.[originalIndex] !== undefined) {
                    return (
                      <Die
                        key={originalIndex}
                        value={displayPlayer.currentDice[originalIndex]}
                        onDiscard={!mustPass ? () => handleUnkeep(originalIndex) : undefined}
                      />
                    )
                  }
                  return <div key={`empty-${slot}`} className="die-placeholder" />
                })}
              </div>

              <div className="my-play__divider" />
              <p className="discard-hint">
                {keptIndices.length > 0 && !mustPass
                  ? 'Toca un dado para devolverlo a la caja'
                  : 'Toca un dado en la caja para guardarlo'}
              </p>
            </div>
          )}

          {!isMyTurn && currentPlayer?.isBot && room.botPhase === 'picking' && botDisplayedKept.length > 0 && (
            <div className="bot-selecting">
              <span className="bot-selecting__label">Bot guarda:</span>
              <div className="bot-selecting__dice">
                {botDisplayedKept.map(i => (
                  <Die key={i} value={currentPlayer.currentDice[i]} small />
                ))}
              </div>
            </div>
          )}

          {displayPlayer?.done && displayPlayer?.hand && (
            <div className="hand-result">{displayPlayer.hand.desc}</div>
          )}
        </div>

        {/* ── Acciones ── */}
        <div className="actions">
          {isMyTurn && !me?.done && (
            <>
              {timeLeft !== null && (
                <div className={`turn-timer ${timeLeft <= 10 ? 'turn-timer--urgent' : ''}`}>
                  {timeLeft}s
                </div>
              )}
              {mustPass ? (
                <div className="actions__row">
                  <button className="btn btn--primary btn--full" onClick={handleStand}>Pasar turno</button>
                </div>
              ) : (
                <div className="actions__row">
                  <button
                    className="btn btn--secondary"
                    onClick={handleStand}
                    disabled={(me?.rollCount ?? 0) === 0 || rolling}
                  >
                    Plantarse
                  </button>
                  <button className="btn btn--primary" onClick={handleRoll} disabled={!canRoll}>
                    Tirar dados
                  </button>
                </div>
              )}
              {shakeEnabled && canRoll && <p className="shake-hint">Agita el móvil para tirar</p>}
              {isMobile() && needsMotionPermission() && !shakeEnabled && (
                <button className="btn btn--secondary btn--full" onClick={enableShakeIOS} style={{ marginTop: 8 }}>
                  Activar agitar
                </button>
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

      {showAlaCaida && (
        <AlaCaidaToast onDone={() => setShowAlaCaida(false)} />
      )}
    </div>
  )
}
