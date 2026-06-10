import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import Die from './Die'
import AnimacionNextPlayer from './AnimacionNextPlayer'
import AnimacionPalilloRoto from './AnimacionPalilloRoto'
import DiceRollerScene from './DiceRollerScene'

const ROLL_WORDS = ['uno', 'dos', 'tres']

const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// Vidas: palillo con 3 roturas; sin palillo → en capilla; repóker → liberado
function PalilloState({ player }) {
  if (player.liberado) return <span className="tag tag--liberado">Liberado</span>
  if (player.breaks >= 3) return <span className="tag tag--capilla">En capilla</span>
  return (
    <span className="palillo" aria-label={`Palillo: ${3 - player.breaks} de 3`}>
      {[0, 1, 2].map(i => (
        <span key={i} className={i < 3 - player.breaks ? 'palillo__seg' : 'palillo__seg palillo__seg--roto'} />
      ))}
    </span>
  )
}
const needsMotionPermission = () =>
  typeof DeviceMotionEvent !== 'undefined' &&
  typeof DeviceMotionEvent.requestPermission === 'function'

export default function GameBoard({ room, myId, onLeave }) {
  const [pendingDiscards, setPendingDiscards] = useState([])
  const [shakeEnabled, setShakeEnabled] = useState(false)
  const [botDiscards, setBotDiscards] = useState([])
  const [timeLeft, setTimeLeft] = useState(null)
  const [rollingIndices, setRollingIndices] = useState([])
  const [sceneValues, setSceneValues] = useState(null)
  const [rollSeed, setRollSeed] = useState(null)
  const [scoreboardDice, setScoreboardDice] = useState({})
  const [leaveIntent, setLeaveIntent] = useState(null) // null | 'refresh' | 'exit'
  const [nextPlayerVisible, setNextPlayerVisible] = useState(false)

  // animacion_next_player: el servidor pausa el turno (awaitingContinue) hasta
  // que alguien pulsa Continuar o expira su contador de 30s
  const awaitingContinue = room.phase === 'playing' && room.awaitingContinue
  useEffect(() => {
    if (awaitingContinue) setNextPlayerVisible(true)
    if (room.phase !== 'playing') setNextPlayerVisible(false)
  }, [awaitingContinue, room.phase])

  // Overlay "palillo roto" al terminar la ronda: marca quién ha perdido
  const [palilloRotoVisible, setPalilloRotoVisible] = useState(false)
  const prevPhaseRef = useRef(room.phase)
  useEffect(() => {
    const prev = prevPhaseRef.current
    if (prev === 'playing' && (room.phase === 'results' || room.phase === 'finished') && (room.roundLoserId || room.gameLoserId)) {
      setPalilloRotoVisible(true)
    }
    if (room.phase === 'playing') setPalilloRotoVisible(false)
    prevPhaseRef.current = room.phase
  }, [room.phase])
  const allowUnloadRef = useRef(false)
  const lastFacesRef = useRef(null)
  const botReadyTimerRef = useRef(null)
  const botReadySentRef = useRef(false)
  const prevBotPhaseRef = useRef(null)
  const prevRollCountRef = useRef({})

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
    setRollingIndices([])
    setSceneValues(null)
    setRollSeed(null)
  }, [room.roundNumber, room.currentPlayerIndex])

  // Reset dados del marcador al empezar nueva ronda
  useEffect(() => {
    setScoreboardDice({})
  }, [room.roundNumber])

  // Detectar nueva tirada (cualquier jugador) → disparar animación 3D con semilla
  useEffect(() => {
    const cp = room.players[room.currentPlayerIndex]
    if (!cp) return
    const prev = prevRollCountRef.current[cp.id] ?? 0
    const curr = cp.rollCount ?? 0
    if (curr > prev && cp.currentDice?.length) {
      const history = cp.rollDiscardHistory ?? []
      const newRolling = history.length === 0
        ? [0, 1, 2, 3, 4]
        : history[history.length - 1]
      setSceneValues([...cp.currentDice])
      setRollingIndices([...newRolling])
      setRollSeed(cp.rollSeed ?? Date.now())
    }
    prevRollCountRef.current[cp.id] = curr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.currentPlayerIndex, room.players[room.currentPlayerIndex]?.rollCount])

  function toggleDiscard(index) {
    setPendingDiscards(prev =>
      prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
    )
  }

  const handleRoll = useCallback(() => {
    if (!canRoll) return
    const keptIndices = [0,1,2,3,4].filter(i =>
      me?.currentDice?.[i] != null && !pendingDiscards.includes(i)
    )
    setPendingDiscards([])
    setRollingIndices([])   // limpia hasta que llegue la respuesta del servidor
    socket.emit('roll', { keptIndices }, (res) => {
      if (!res?.ok && res?.error) alert(res.error)
    })
  }, [canRoll, me, pendingDiscards])

  function handleStand() {
    socket.emit('stand', { faces: lastFacesRef.current }, (res) => {
      if (!res?.ok && res?.error) alert(res.error)
    })
  }

  function handleNextRound() { socket.emit('next_round') }
  function handleRematch() { socket.emit('rematch') }

  function confirmLeave() {
    allowUnloadRef.current = true
    socket.emit('leave_room')
    if (leaveIntent === 'refresh') {
      // Pequeño margen para que leave_room llegue antes de recargar
      setTimeout(() => window.location.reload(), 150)
    } else {
      onLeave()
    }
  }

  // Aviso nativo si se recarga/cierra desde el propio navegador
  useEffect(() => {
    function onBeforeUnload(e) {
      if (allowUnloadRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // Pull-to-refresh en móvil → modal de confirmación (el nativo está
  // desactivado con overscroll-behavior-y en index.css)
  useEffect(() => {
    let startX = null, startY = null, triggered = false
    function onTouchStart(e) {
      if (window.scrollY > 0) { startY = null; return }
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      triggered = false
    }
    function onTouchMove(e) {
      if (startY === null || triggered) return
      const dy = e.touches[0].clientY - startY
      const dx = Math.abs(e.touches[0].clientX - startX)
      if (dy > 90 && dy > dx * 2 && window.scrollY <= 0) {
        triggered = true
        setLeaveIntent('refresh')
      }
    }
    function onTouchEnd() { startY = null }
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

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

  // Bot: tras tirar espera a que los dados caigan y se paren (onSettled de la
  // escena 3D); después marca sus descartes de uno en uno cada 300ms y relanza.
  const botPhase = room.botPhase
  useEffect(() => {
    clearTimeout(botReadyTimerRef.current)

    if (botPhase !== prevBotPhaseRef.current) {
      prevBotPhaseRef.current = botPhase
      botReadySentRef.current = false
      setBotDiscards([])
    }
    if (!botPhase) return

    const emitBotReady = () => {
      if (botReadySentRef.current) return
      botReadySentRef.current = true
      socket.emit('bot_ready')
    }

    if (botPhase === 'rolled') {
      // Fallback por si la animación nunca llega a dispararse (el camino
      // normal es onSettled de la escena 3D)
      botReadyTimerRef.current = setTimeout(emitBotReady, 8000)
      return () => clearTimeout(botReadyTimerRef.current)
    }

    if (botPhase === 'picking') {
      const kept = room.botKeptIndices ?? []
      const discards = [0, 1, 2, 3, 4].filter(i => !kept.includes(i))
      let i = 0
      const pickNext = () => {
        if (i < discards.length) {
          const idx = discards[i++]
          setBotDiscards(prev => [...prev, idx])
          botReadyTimerRef.current = setTimeout(pickNext, 300)
        } else {
          botReadyTimerRef.current = setTimeout(emitBotReady, 300)
        }
      }
      botReadyTimerRef.current = setTimeout(pickNext, 300)
      return () => clearTimeout(botReadyTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botPhase])

  // Countdown timer
  useEffect(() => {
    if (!room.turnDeadline || !isMyTurn) { setTimeLeft(null); return }
    const update = () => setTimeLeft(Math.max(0, Math.ceil((room.turnDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [room.turnDeadline, isMyTurn])

  const displayPlayer = isMyTurn ? me : currentPlayer

  return (
    <div className="screen game">
      <nav className="navbar">
        <button className="navbar__exit" onClick={() => setLeaveIntent('exit')}>← Salir</button>
        <span className="navbar__round">
          Ronda {room.roundNumber}{room.maxRounds > 0 ? ` / ${room.maxRounds}` : ''}
        </span>
      </nav>

      {/* Fin de partida */}
      {room.phase === 'finished' ? (() => {
        const sorted = [...room.players].sort((a, b) => b.wins - a.wins)
        const gameLoser = room.players.find(p => p.id === room.gameLoserId)
        return (
          <>
            {gameLoser ? (
              <div className="results__winner">
                <p className="results__winner-label">Pierde la partida</p>
                <h2 className="results__name">{gameLoser.name}</h2>
                <p className="results__hand">
                  {room.endReason === 'rounds'
                    ? 'El peor clasificado al límite de rondas'
                    : 'Ha perdido estando en capilla'}
                </p>
              </div>
            ) : (
              <div className="results__winner">
                <p className="results__winner-label">Campeón de la partida</p>
                <h2 className="results__name">{sorted[0]?.name}</h2>
                <p className="results__hand">{sorted[0]?.wins} victorias</p>
              </div>
            )}
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
            {(() => {
              const rl = room.players.find(p => p.id === room.roundLoserId)
              if (!rl) return null
              return (
                <p className="results__palillo">
                  {rl.name} rompe un palillo{rl.breaks >= 3 ? ' — ¡queda en capilla!' : ''}
                </p>
              )
            })()}
            {room.players.filter(p => p.liberado && p.hand?.rank === 7).map(p => (
              <p key={p.id} className="results__liberado">{p.name} se libera con repóker</p>
            ))}
            <div className="results__hands">
              {room.players.map(p => (
                <div key={p.id} className={`results__row ${p.id === room.roundWinnerId ? 'results__row--winner' : ''} ${p.id === room.roundLoserId ? 'results__row--loser' : ''}`}>
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
            {[...room.players].sort((a, b) => b.wins - a.wins).map((p, i) => {
              const isRolling = rollingIndices.length > 0 && p.id === currentPlayer?.id
              const dice = isRolling
                ? (scoreboardDice[p.id] ?? [])
                : (scoreboardDice[p.id] ?? p.currentDice ?? [])
              return (
                <div key={p.id} className={`scoreboard__row ${p.id === currentPlayer?.id ? 'scoreboard__row--active' : ''}`}>
                  <span className="scoreboard__pos">{i + 1}.</span>
                  <span className="scoreboard__name">{p.name}{p.id === myId ? ' (tú)' : ''}</span>
                  <PalilloState player={p} />
                  {dice.length > 0 && (
                    <div className="scoreboard__dice">
                      {dice.map((v, j) => <Die key={j} value={v} small />)}
                    </div>
                  )}
                  <span className="scoreboard__wins">{p.wins}</span>
                </div>
              )
            })}
          </div>

          <div className="dice-box">
            <DiceRollerScene
              values={sceneValues}
              rollingIndices={rollingIndices}
              pendingDiscards={isMyTurn ? pendingDiscards : botDiscards}
              interactive={isMyTurn && !me?.done && !mustPass && (me?.rollCount ?? 0) > 0}
              onDieClick={toggleDiscard}
              seed={rollSeed}
              onSettled={(faces) => {
                setRollingIndices([])
                if (faces?.length === 5) {
                  lastFacesRef.current = faces
                  setScoreboardDice(prev => ({ ...prev, [currentPlayer?.id]: faces }))
                }
                if (isMyTurn && faces?.length === 5) socket.emit('report_faces', { faces })
                // Bot: los dados ya han caído y están parados → puede decidir
                if (currentPlayer?.isBot && room.botPhase === 'rolled') {
                  if (faces?.length === 5) socket.emit('report_faces', { faces })
                  if (!botReadySentRef.current) {
                    botReadySentRef.current = true
                    clearTimeout(botReadyTimerRef.current)
                    socket.emit('bot_ready')
                  }
                }
              }}
            />
          </div>

          {(() => {
            const rollNum = displayPlayer?.rollCount ?? 0
            const isInteractive = isMyTurn && !me?.done && !mustPass && rollNum > 0
            return (
              <div className="game-hand">
                <div className="game-hand__header">
                  <span className="game-hand__title">
                    {isMyTurn ? 'Tu jugada' : `Turno de ${currentPlayer?.name}`}
                  </span>
                  {rollNum > 0 && (
                    <span className="game-hand__tirada">
                      Tirada {ROLL_WORDS[rollNum - 1] ?? rollNum}
                    </span>
                  )}
                </div>
                <div className="game-hand__separator" />
                {displayPlayer?.done && displayPlayer?.hand
                  ? <p className="hand-result">{displayPlayer.hand.desc}</p>
                  : displayPlayer?.hand && rollNum > 0
                    ? <>
                        <p className="hand-result hand-result--live">{displayPlayer.hand.desc}</p>
                        {isInteractive && <p className="game-hand__hint">Toca un dado para descartarlo</p>}
                      </>
                    : rollNum === 0
                      ? <p className="game-hand__hint">Tira los dados para empezar</p>
                      : null
                }
              </div>
            )
          })()}

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
            {me?.done && (
              <p className="waiting-label">Tu mano: {me?.hand?.desc}</p>
            )}
          </div>
        </>
      )}

      {nextPlayerVisible && (
        <AnimacionNextPlayer
          room={room}
          closing={!awaitingContinue}
          onContinue={() => socket.emit('continue_turn')}
          onDone={() => setNextPlayerVisible(false)}
        />
      )}

      {palilloRotoVisible && (
        <AnimacionPalilloRoto room={room} onDone={() => setPalilloRotoVisible(false)} />
      )}

      {leaveIntent && (
        <div className="modal-overlay">
          <div className="modal" role="alertdialog" aria-modal="true">
            <h2 className="modal__title">Abandonar la partida</h2>
            <p className="modal__text">¿Estás seguro de que quieres abandonar la partida?</p>
            <div className="modal__actions">
              <button className="btn btn--secondary" onClick={() => setLeaveIntent(null)}>Continuar</button>
              <button className="btn btn--primary" onClick={confirmLeave}>Abandonar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
