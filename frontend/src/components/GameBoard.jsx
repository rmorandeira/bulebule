import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import Die from './Die'
import AlaCaidaToast from './AlaCaidaToast'

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
const needsMotionPermission = () =>
  typeof DeviceMotionEvent !== 'undefined' &&
  typeof DeviceMotionEvent.requestPermission === 'function'

// Divide los dados actuales en grupos por tirada
function getRollBatches(player) {
  const { currentDice, rollDiscardHistory } = player
  if (!currentDice?.length) return []

  const batches = []
  let batchIndices = Array.from({ length: currentDice.length }, (_, i) => i)

  for (let n = 0; n < (rollDiscardHistory?.length ?? 0); n++) {
    const discarded = rollDiscardHistory[n]
    const kept = batchIndices.filter(i => !discarded.includes(i))
    if (kept.length > 0) batches.push({ rollNum: n + 1, indices: kept })
    batchIndices = discarded
  }

  if (batchIndices.length > 0)
    batches.push({ rollNum: (rollDiscardHistory?.length ?? 0) + 1, indices: batchIndices })

  return batches
}

export default function GameBoard({ room, myId, onLeave }) {
  const [pendingDiscards, setPendingDiscards] = useState([])
  const [shakeEnabled, setShakeEnabled] = useState(false)
  const [showAlaCaida, setShowAlaCaida] = useState(false)
  const [botDisplayedKept, setBotDisplayedKept] = useState([])
  const [timeLeft, setTimeLeft] = useState(null)
  const prevDoneRef = useRef({})
  const botReadyTimerRef = useRef(null)

  const me = room.players.find(p => p.id === myId)
  const currentPlayer = room.players[room.currentPlayerIndex]
  const isMyTurn = currentPlayer?.id === myId
  const maxAllowed = room.maxRolls ?? 3
  const mustPass = isMyTurn && !me?.done && (me?.rollCount ?? 0) >= maxAllowed
  const rollCount = me?.rollCount ?? 0
  const canRoll = isMyTurn && !me?.done && !mustPass &&
    (rollCount === 0 || pendingDiscards.length > 0)

  // Reset al cambiar turno o ronda
  useEffect(() => {
    setPendingDiscards([])
  }, [room.roundNumber, room.currentPlayerIndex])

  function toggleDiscard(index) {
    setPendingDiscards(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    )
  }

  const handleRoll = useCallback(() => {
    if (!canRoll) return
    const batches = getRollBatches(me ?? {})
    const allIndices = batches.flatMap(b => b.indices)
    const keptIndices = allIndices.filter(i => !pendingDiscards.includes(i))
    setPendingDiscards([])
    socket.emit('roll', { keptIndices }, (res) => {
      if (!res?.ok && res?.error) alert(res.error)
    })
  }, [canRoll, me, pendingDiscards])

  function handleStand() {
    socket.emit('stand', (res) => {
      if (!res?.ok && res?.error) alert(res.error)
    })
  }

  function handleNextRound() { socket.emit('next_round') }
  function handleRematch() { socket.emit('rematch') }
  function handleLeave() { socket.emit('leave_room'); onLeave() }

  // Shake to roll
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

  // Detectar "a la caída"
  const playerDoneKey = room.players.map(p => `${p.id}:${p.done}:${p.rollCount}`).join('|')
  useEffect(() => {
    const noneWereDone = Object.values(prevDoneRef.current).every(done => !done)
    room.players.forEach(p => {
      const wasNotDone = !prevDoneRef.current[p.id]
      if (p.done && wasNotDone && p.rollCount === 1 && noneWereDone) setShowAlaCaida(true)
    })
    const next = {}
    room.players.forEach(p => { next[p.id] = p.done })
    prevDoneRef.current = next
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerDoneKey])

  // Bot timing (sin 3D: esperas fijas)
  const botPhase = room.botPhase
  useEffect(() => {
    clearTimeout(botReadyTimerRef.current)
    setBotDisplayedKept([])
    if (!botPhase) return

    if (botPhase === 'rolled') {
      if (showAlaCaida) return
      botReadyTimerRef.current = setTimeout(() => socket.emit('bot_ready'), 800)
      return () => clearTimeout(botReadyTimerRef.current)
    }

    if (botPhase === 'picking') {
      const indices = room.botKeptIndices ?? []
      let i = 0
      const showNext = () => {
        if (i < indices.length) {
          setBotDisplayedKept(prev => [...prev, indices[i++]])
          botReadyTimerRef.current = setTimeout(showNext, 200)
        } else {
          botReadyTimerRef.current = setTimeout(() => socket.emit('bot_ready'), 200)
        }
      }
      botReadyTimerRef.current = setTimeout(showNext, 200)
      return () => clearTimeout(botReadyTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botPhase, showAlaCaida])

  // Countdown timer
  useEffect(() => {
    if (!room.turnDeadline || !isMyTurn) { setTimeLeft(null); return }
    const update = () => setTimeLeft(Math.max(0, Math.ceil((room.turnDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [room.turnDeadline, isMyTurn])

  const displayPlayer = isMyTurn ? me : currentPlayer

  function renderBatches(player, interactive) {
    const batches = getRollBatches(player ?? {})
    if (!batches.length) return null
    return batches.map(batch => (
      <div key={batch.rollNum} className="roll">
        <span className="roll__label">Tirada {batch.rollNum}</span>
        {interactive && (
          <p className="roll__hint">Toca o desliza un dado para descartarlo</p>
        )}
        <div className="roll__dice">
          {batch.indices.map(idx => (
            <Die
              key={idx}
              value={player.currentDice[idx]}
              discarded={interactive && pendingDiscards.includes(idx)}
              onDiscard={interactive ? () => toggleDiscard(idx) : undefined}
            />
          ))}
        </div>
      </div>
    ))
  }

  return (
    <div className="screen game">
      <nav className="navbar">
        <button className="navbar__exit" onClick={handleLeave}>← Salir</button>
        <span className="navbar__round">
          Ronda {room.roundNumber}{room.maxRounds > 0 ? ` / ${room.maxRounds}` : ''}
        </span>
      </nav>

      {/* Fin de partida */}
      {room.phase === 'finished' ? (() => {
        const sorted = [...room.players].sort((a, b) => b.wins - a.wins)
        return (
          <>
            <div className="results__winner">
              <p className="results__winner-label">Campeón de la partida</p>
              <h2 className="results__name">{sorted[0]?.name}</h2>
              <p className="results__hand">{sorted[0]?.wins} victorias</p>
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
              : <p className="waiting-label">Esperando al host...</p>}
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
                    {p.currentDice?.map((v, i) => <Die key={i} value={v} small />)}
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
              : <p className="waiting-label">Esperando al host...</p>}
          </>
        )
      })() : (
        <>
          <div className="scoreboard">
            <p className="scoreboard__title">Clasificación</p>
            {[...room.players].sort((a, b) => b.wins - a.wins).map((p, i) => (
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

          <div className="rolls">
            {renderBatches(displayPlayer, isMyTurn && !me?.done && !mustPass)}

            {!isMyTurn && currentPlayer?.isBot && botPhase === 'picking' && botDisplayedKept.length > 0 && (
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
                    <button className="btn btn--secondary" onClick={handleStand} disabled={rollCount === 0}>
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

      {showAlaCaida && <AlaCaidaToast onDone={() => setShowAlaCaida(false)} />}
    </div>
  )
}
