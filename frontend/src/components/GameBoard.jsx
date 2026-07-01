import { useState, useEffect, useCallback, useRef } from 'react'
import socket from '../socket'
import { track } from '../analytics'
import { IS_NATIVE, showBanner, removeBanner } from '../utils/admob'
import Die from './Die'
import AnimacionNextPlayer from './AnimacionNextPlayer'
import AnimacionPalilloRoto from './AnimacionPalilloRoto'
import DiceRollerScene from './DiceRollerScene'
import CountdownButton from './CountdownButton'

const ROLL_WORDS = ['uno', 'dos', 'tres']

const DIE_RANK = { AS: 6, K: 5, Q: 4, J: 3, '8': 2, '7': 1 }
const handPts = rank => 8 + (rank ?? 0) * 4
const sortDice = arr => [...arr].sort((a, b) => (DIE_RANK[b] ?? 0) - (DIE_RANK[a] ?? 0))

const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

const _audioDiscard    = new Audio('/assets/cogerdado.mp3')
const _audioPalillo    = new Audio('/assets/romper_palillo.mp3')
function playDiscardSound() { _audioDiscard.currentTime = 0; _audioDiscard.play().catch(() => {}) }
function playPalilloSound() { _audioPalillo.currentTime = 0; _audioPalillo.play().catch(() => {}) }

function PalilloState({ player }) {
  if (player.liberado) return <span className="tag tag--liberado">Liberado</span>
  if ((player.breaks ?? 0) >= 3) return <span className="tag tag--capilla">En capilla</span>
  const breaks = player.breaks ?? 0
  return (
    <span className="palillo" aria-label={`Palillo: ${3 - breaks} de 3`}>
      {[0, 1, 2].map(i => (
        <span key={i} className={i < 3 - breaks ? 'palillo__seg' : 'palillo__seg palillo__seg--roto'} />
      ))}
    </span>
  )
}
const needsMotionPermission = () =>
  typeof DeviceMotionEvent !== 'undefined' &&
  typeof DeviceMotionEvent.requestPermission === 'function'

export default function GameBoard({ room, myId, onLeave, musicOn, onToggleMusic }) {
  const [pendingDiscards, setPendingDiscards] = useState([])
  const [shakeEnabled, setShakeEnabled] = useState(false)
  const [botDiscards, setBotDiscards] = useState([])
  const [timeLeft, setTimeLeft] = useState(null)
  const [waitTimeLeft, setWaitTimeLeft] = useState(null)
  const [continueSecondsLeft, setContinueSecondsLeft] = useState(null)
  const [rollingIndices, setRollingIndices] = useState([])
  const [sceneValues, setSceneValues] = useState(null)
  const [rollSeed, setRollSeed] = useState(null)
  const [scoreboardDice, setScoreboardDice] = useState({})
  const [leaveIntent, setLeaveIntent] = useState(null) // null | 'refresh' | 'exit'
  const [rolling, setRolling] = useState(false)
  const [nextPlayerVisible, setNextPlayerVisible] = useState(false)
  const [scoreDeltas, setScoreDeltas] = useState({})  // { [playerId]: deltaValue }
  const prevScoresRef = useRef({})                    // { [playerId]: score }

  // animacion_next_player: el servidor pausa el turno (awaitingContinue) hasta
  // que alguien pulsa Continuar o expira su contador de 30s
  const awaitingContinue = room.phase === 'playing' && room.awaitingContinue
  useEffect(() => {
    if (awaitingContinue) setNextPlayerVisible(true)
    if (room.phase !== 'playing') setNextPlayerVisible(false)
  }, [awaitingContinue, room.phase])

  // Banner nativo inferior — se muestra durante la partida
  useEffect(() => {
    if (!IS_NATIVE) return
    showBanner('BOTTOM_CENTER')
    return () => removeBanner()
  }, [])

  // Wake lock — evitar que la pantalla se apague durante la partida
  useEffect(() => {
    if (!('wakeLock' in navigator)) return
    let lock = null
    navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
    const reacquire = () => {
      if (document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', reacquire)
    return () => {
      document.removeEventListener('visibilitychange', reacquire)
      lock?.release().catch(() => {})
    }
  }, [])

  // Re-mostrar banner inferior al cerrar la animación entre turnos
  // (AnimacionNextPlayer muestra el TOP y llama removeBanner al desmontar)
  useEffect(() => {
    if (IS_NATIVE && !nextPlayerVisible) showBanner('BOTTOM_CENTER')
  }, [nextPlayerVisible])

  const [palilloRotoShowing, setPalilloRotoShowing] = useState(false)
  const prevPhaseRef = useRef(room.phase)
  useEffect(() => {
    const prev = prevPhaseRef.current
    prevPhaseRef.current = room.phase
    if ((prev === 'playing' || prev === 'tiebreak') && (room.phase === 'results' || room.phase === 'finished') && (room.roundLoserId || room.gameLoserId)) {
      setPalilloRotoShowing(true)
      playPalilloSound()
    }
    if (room.phase === 'playing' || room.phase === 'tiebreak') setPalilloRotoShowing(false)
  }, [room.phase, room.roundLoserId, room.gameLoserId])

  // Detecta cambios de puntuación y muestra badge flotante +/- pts
  useEffect(() => {
    const deltas = {}
    for (const p of room.players) {
      if (p.score === null) continue
      const prev = prevScoresRef.current[p.id]
      if (prev !== undefined && p.score !== prev) deltas[p.id] = p.score - prev
      prevScoresRef.current[p.id] = p.score
    }
    if (Object.keys(deltas).length === 0) return
    setScoreDeltas(deltas)
    const t = setTimeout(() => setScoreDeltas({}), 2500)
    return () => clearTimeout(t)
  }, [room.players])

  const allowUnloadRef        = useRef(false)
  const lastFacesRef          = useRef(null)
  const gameEndTrackedRef     = useRef(false)
  const prevLiberadosRef      = useRef(new Set())
  const botReadyTimerRef = useRef(null)
  const botReadySentRef = useRef(false)
  const prevBotPhaseRef = useRef(null)
  const prevRollCountRef = useRef({})

  // Analytics: game_start on mount
  useEffect(() => {
    track('game_start', { playerCount: room.players.length, vsBot: room.vsBot ?? false })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Analytics: game_end when phase becomes 'finished'
  useEffect(() => {
    if (room.phase === 'finished' && !gameEndTrackedRef.current) {
      gameEndTrackedRef.current = true
      track('game_end', { endReason: room.endReason ?? 'unknown', rounds: room.roundNumber, playerCount: room.players.length })
    }
  }, [room.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Analytics: player_liberado — fire once per player
  useEffect(() => {
    room.players.forEach(p => {
      if (p.liberado && !prevLiberadosRef.current.has(p.id)) {
        prevLiberadosRef.current.add(p.id)
        track('player_liberado', { playerName: p.name })
      }
    })
  }, [room.players])

  const me = room.players.find(p => p.id === myId)
  const currentPlayer = room.players[room.currentPlayerIndex]
  const isMyTurn = currentPlayer?.id === myId
  const maxAllowed = room.maxRolls ?? 3
  const mustPass = isMyTurn && !me?.done && ((me?.rollCount ?? 0) >= maxAllowed || me?.hand?.rank === 7)
  const rollCount = me?.rollCount ?? 0
  const canRoll = isMyTurn && !me?.done && !mustPass &&
    (rollCount === 0 || pendingDiscards.length > 0)
  const isAnimating = rolling || rollingIndices.length > 0

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
    setPendingDiscards(prev => {
      const next = prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      if (!prev.includes(index)) playDiscardSound()
      socket.emit('discard', { indices: next })
      return next
    })
  }

  const handleRoll = useCallback(() => {
    if (!canRoll || rolling) return
    setRolling(true)
    const keptIndices = [0,1,2,3,4].filter(i =>
      me?.currentDice?.[i] != null && !pendingDiscards.includes(i)
    )
    setPendingDiscards([])
    setRollingIndices([])   // limpia hasta que llegue la respuesta del servidor
    socket.emit('roll', { keptIndices }, (res) => {
      setRolling(false)
      if (!res?.ok && res?.error) alert(res.error)
    })
  }, [canRoll, rolling, me, pendingDiscards])

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
    if (IS_MOBILE && !needsMotionPermission()) setShakeEnabled(true)
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
          playDiscardSound()
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

  // Countdown timer — active player
  useEffect(() => {
    if (!room.turnDeadline || !isMyTurn) { setTimeLeft(null); return }
    const update = () => setTimeLeft(Math.max(0, Math.ceil((room.turnDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [room.turnDeadline, isMyTurn])

  // Countdown timer — waiting player
  useEffect(() => {
    if (!room.turnDeadline || isMyTurn) { setWaitTimeLeft(null); return }
    const update = () => setWaitTimeLeft(Math.max(0, Math.ceil((room.turnDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [room.turnDeadline, isMyTurn])

  // Countdown timer — results/palillo phase (continueDeadline)
  useEffect(() => {
    if (!room.continueDeadline || room.phase === 'playing') { setContinueSecondsLeft(null); return }
    const update = () => setContinueSecondsLeft(Math.max(0, Math.ceil((room.continueDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [room.continueDeadline, room.phase])

  const displayPlayer = isMyTurn ? me : currentPlayer

  return (
    <div className="screen game">
      <nav className="navbar">
        <button className="navbar__exit" onClick={() => setLeaveIntent('exit')}>‹ Salir</button>
        <span className="navbar__room">{room.name || `Ronda ${room.roundNumber}`}</span>
        <div className="navbar__right">
          <span className="navbar__round">
            {room.maxRounds > 0 ? `${room.roundNumber}/${room.maxRounds}` : ''}
          </span>
          <button className="music-btn" onClick={onToggleMusic} aria-label={musicOn ? 'Silenciar música' : 'Activar música'}>
            {musicOn ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            )}
          </button>
        </div>
      </nav>

      {/* Fin de partida */}
      {room.phase === 'finished' ? (() => {
        const sorted = [...room.players].sort((a, b) => b.wins - a.wins)
        const gameLoser = room.players.find(p => p.id === room.gameLoserId)
        return (
          <>
          <div className="game-body game-body--full">
          <div className="results">
            {gameLoser ? (
              <div className="results__winner">
                <p className="results__winner-label">Pierde la partida</p>
                <h2 className="results__name">{gameLoser.name}</h2>
                <p className="results__hand">
                  {room.endReason === 'rounds'
                    ? 'El peor clasificado al límite de rondas'
                    : room.endReason === 'liberado'
                    ? gameLoser.breaks >= 3
                      ? 'El rival consiguió un Repóker · estaba en capilla'
                      : 'El rival consiguió un Repóker'
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
              <div className="results__scores-header">
                <p className="results__scores-title">Clasificación</p>
                <div className="scoreboard__col-headers">
                  <span className="scoreboard__col-pts">Bules</span>
                  <span className="scoreboard__trophy">🏆</span>
                </div>
              </div>
              {sorted.map((p) => {
                const delta = scoreDeltas[p.id]
                return (
                  <div key={p.id} className="results__score-row">
                    <PalilloState player={p} />
                    <span className="results__sname">{p.name}</span>
                    <span className="scoreboard__pts-num" style={{ position: 'relative' }}>
                      {p.score != null ? p.score.toLocaleString() : '—'}
                      {delta !== undefined && (
                        <span className={`score-delta${delta >= 0 ? ' score-delta--pos' : ' score-delta--neg'}`}>
                          {delta >= 0 ? '+' : ''}{delta}
                        </span>
                      )}
                    </span>
                    <span className="scoreboard__wins-num">{p.wins}</span>
                  </div>
                )
              })}
            </div>
          </div>
          </div>
          {room.hostId === myId
            ? <button className="results-action-btn btn btn--primary" onClick={handleRematch}>Otra partida</button>
            : <p className="results-action-label">Esperando al host...</p>}
        </>
        )
      })() : room.phase === 'results' ? (() => {
        const winner = room.players.find(p => p.id === room.roundWinnerId)
        const sorted = [...room.players].sort((a, b) => b.wins - a.wins)
        const loserIsBot = room.players.find(p => p.id === room.roundLoserId)?.isBot
        const iCanAdvance = room.roundLoserId === myId || loserIsBot
        return (
          <>
          <div className="results">
            <div className="results__winner">
              <p className="results__winner-label">🏆 Ganador 🏆</p>
              <h2 className="results__name">{winner?.name}</h2>
              <p className="results__hand">
                {winner?.hand?.desc}
                {winner?.hand?.rank != null && <span className="results__hand-pts">+{handPts(winner.hand.rank)} B</span>}
              </p>
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
                  <div className="results__player-info">
                    <span className="results__player">{p.name}</span>
                    {p.hand && (
                      <span className="results__desc">
                        {p.hand.desc}
                        {p.id === room.roundWinnerId && p.hand?.rank != null && (
                          <span className="results__hand-pts">+{handPts(p.hand.rank)} B</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="results__dice">
                    {sortDice(p.currentDice ?? []).map((v, i) => <Die key={i} value={v} small skin={p.diceSkin} />)}
                  </div>
                  <span className="results__wins">{p.wins}</span>
                </div>
              ))}
            </div>
            <div className="results__scores">
              {palilloRotoShowing
                ? <AnimacionPalilloRoto
                    room={room}
                    onDone={() => setPalilloRotoShowing(false)}
                  />
                : <>
                    <div className="results__scores-header">
                      <p className="results__scores-title">Clasificación</p>
                      <div className="scoreboard__col-headers">
                        <span className="scoreboard__col-pts">Bules</span>
                        <span className="scoreboard__trophy">🏆</span>
                      </div>
                    </div>
                    {sorted.map((p) => {
                      const delta = scoreDeltas[p.id]
                      return (
                        <div key={p.id} className="results__score-row">
                          <PalilloState player={p} />
                          <span className="results__sname">{p.name}</span>
                          <span className="scoreboard__pts-num" style={{ position: 'relative' }}>
                            {p.score != null ? p.score.toLocaleString() : '—'}
                            {delta !== undefined && (
                              <span className={`score-delta${delta >= 0 ? ' score-delta--pos' : ' score-delta--neg'}`}>
                                {delta >= 0 ? '+' : ''}{delta}
                              </span>
                            )}
                          </span>
                          <span className="scoreboard__wins-num">{p.wins}</span>
                        </div>
                      )
                    })}
                  </>
              }
            </div>
          </div>
          {!palilloRotoShowing && (iCanAdvance
            ? <CountdownButton
                className="btn--primary results-action-btn"
                deadline={room.continueDeadline}
                totalMs={30_000}
                onClick={handleNextRound}
              >
                Siguiente ronda
              </CountdownButton>
            : <p className="results-action-label">
                {continueSecondsLeft !== null ? `Esperando al jugador (${continueSecondsLeft}s)` : 'Esperando al jugador...'}
              </p>
          )}
          </>
        )
      })() : room.phase === 'tiebreak' ? (() => {
        const tb = room.tiebreaker
        if (!tb) return null
        const meInTiebreak = tb.playerIds.includes(myId)
        const isMyTiebreakerTurn = tb.currentPlayerId === myId

        function handleTiebreakRoll() {
          socket.emit('tiebreak_roll', {}, (res) => {
            if (!res?.ok) alert('Error en el desempate')
          })
        }

        return (
          <div className="game-body game-body--full">
          <div className="results">
            <div className="results__winner">
              <p className="results__winner-label">
                {tb.round > 1 ? `Desempate · Ronda ${tb.round}` : 'Desempate a la caída'}
              </p>
              <h2 className="results__name">¡Empate!</h2>
              <p className="results__hand">Cada jugador tira un dado — el peor rompe un palillo</p>
            </div>

            <div className="tiebreak__players">
              {tb.playerIds.map(playerId => {
                const player = room.players.find(p => p.id === playerId)
                const result = tb.results[playerId]
                const isCurrent = tb.currentPlayerId === playerId
                return (
                  <div key={playerId} className={`tiebreak__row${isCurrent ? ' tiebreak__row--active' : ''}`}>
                    <span className="tiebreak__name">
                      {player?.name}{playerId === myId ? ' (tú)' : ''}
                    </span>
                    <div className="tiebreak__die-slot">
                      {result
                        ? <Die value={result} skin={player?.diceSkin ?? null} />
                        : <span className="tiebreak__pending">{isCurrent ? '🎲' : '·  ·  ·'}</span>
                      }
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="actions">
              {isMyTiebreakerTurn && (
                <div className="actions__row">
                  <button className="btn btn--primary btn--full" onClick={handleTiebreakRoll}>
                    Tirar un dado
                  </button>
                </div>
              )}
              {!isMyTiebreakerTurn && tb.currentPlayerId && (() => {
                const waiting = room.players.find(p => p.id === tb.currentPlayerId)
                return (
                  <p className="waiting-label">
                    Esperando a {waiting?.name ?? '…'}
                  </p>
                )
              })()}
              {!meInTiebreak && !tb.currentPlayerId && (
                <p className="waiting-label">Calculando desempate…</p>
              )}
            </div>
          </div>
          </div>
        )
      })() : (
        <div className="game-body">
          <div className="game-sidebar">
          <div className="scoreboard">
            <div className="scoreboard__header">
              <p className="scoreboard__title">
                {room.desempate ? 'Desempate' : 'Clasificación'}
              </p>
              <div className="scoreboard__col-headers">
                <span className="scoreboard__col-pts">Bules</span>
                <span className="scoreboard__trophy">🏆</span>
              </div>
            </div>
            {[...room.players].sort((a, b) => b.wins - a.wins).map((p) => {
              const isActive = p.id === currentPlayer?.id
              const isRolling = rollingIndices.length > 0 && isActive
              const dice = isRolling
                ? (scoreboardDice[p.id] ?? [])
                : (p.currentDice?.length > 0 ? p.currentDice : [])
              const delta = scoreDeltas[p.id]
              return (
                <div key={p.id} className={`scoreboard__row ${isActive ? 'scoreboard__row--active' : ''} ${p.done ? 'scoreboard__row--done' : ''}`}>
                  <PalilloState player={p} />
                  <div className="scoreboard__player-info">
                    <span className="scoreboard__name">{p.name}{p.id === myId ? ' (tú)' : ''}</span>
                    {p.done && p.hand && (
                      <span className="scoreboard__hand-label">
                        {p.hand.desc}
                        {p.hand.rank != null && <span className="results__hand-pts">+{handPts(p.hand.rank)} B</span>}
                      </span>
                    )}
                  </div>
                  {p.inDesempate && <span className="tag tag--desempate">DESEMPATE</span>}
                  {dice.length > 0 && (
                    <div className="scoreboard__dice">
                      {sortDice(dice).map((v, j) => <Die key={j} value={v} small skin={p.diceSkin} />)}
                    </div>
                  )}
                  <span className="scoreboard__pts-num" style={{ position: 'relative' }}>
                    {p.score != null ? p.score.toLocaleString() : '—'}
                    {delta !== undefined && (
                      <span className={`score-delta${delta >= 0 ? ' score-delta--pos' : ' score-delta--neg'}`}>
                        {delta >= 0 ? '+' : ''}{delta}
                      </span>
                    )}
                  </span>
                  <span className="scoreboard__wins-num">{p.wins}</span>
                </div>
              )
            })}
          </div>
          </div>{/* /game-sidebar */}
          <div className="game-main">

          {room.desempate && !me?.inDesempate ? (
            <div className="dice-box dice-box--waiting">
              <p className="dice-box__waiting-label">Esperando resultado del desempate…</p>
              <p className="dice-box__waiting-sub">
                {[...room.players].filter(p => p.inDesempate).map(p => p.name).join(' · ')}
              </p>
            </div>
          ) : (() => {
            const rollNum = displayPlayer?.rollCount ?? 0

            // Jugada mínima = la peor mano de los jugadores ya terminados (la que hay que superar para no perder)
            let minHand = null
            for (const p of room.players) {
              if (p.inDesempate ? (p.done && p.hand) : (p.done && p.hand && !room.desempate)) {
                if (!minHand || p.hand.rank < minHand.hand.rank ||
                  (p.hand.rank === minHand.hand.rank && (p.hand.topKey ?? '') < (minHand.hand.topKey ?? ''))) minHand = p
              }
            }

            // Si el jugador activo ya ha terminado y su mano es la mínima, es él quien lleva la peor
            const myHandIsBelowMin = me?.done && minHand && isMyTurn === false && me?.hand &&
              (me.hand.rank < minHand.hand.rank ||
               (me.hand.rank === minHand.hand.rank && (me.hand.topKey ?? '') <= (minHand.hand.topKey ?? '')))

            return (
              <div className="dice-box">
                <div className="dice-box__header">
                  <span className="dice-box__label">
                    {isMyTurn ? 'Tu jugada' : `Turno de ${currentPlayer?.name}`}
                  </span>
                  {displayPlayer?.hand?.rank != null && (
                    <span className="dice-box__hand">
                      {displayPlayer.hand.desc}
                      <span className="dice-box__hand-pts">+{handPts(displayPlayer.hand.rank)} B</span>
                    </span>
                  )}
                </div>
                <div className="dice-box__scene">
                  <DiceRollerScene
                    values={sceneValues}
                    rollingIndices={rollingIndices}
                    pendingDiscards={
                      isMyTurn
                        ? pendingDiscards
                        : currentPlayer?.isBot
                          ? botDiscards
                          : (currentPlayer?.pendingDiscards ?? [])
                    }
                    interactive={isMyTurn && !me?.done && !mustPass && rollNum > 0}
                    onDieClick={toggleDiscard}
                    seed={rollSeed}
                    sorted={!!displayPlayer?.done}
                    skin={isMyTurn ? undefined : (currentPlayer?.diceSkin ?? null)}
                    onSettled={(faces) => {
                      setRollingIndices([])
                      if (faces?.length === 5) {
                        lastFacesRef.current = faces
                        setScoreboardDice(prev => ({ ...prev, [currentPlayer?.id]: faces }))
                      }
                      if (isMyTurn && faces?.length === 5) socket.emit('report_faces', { faces })
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
                <div className="dice-box__footer">
                  {minHand ? (
                    <>
                      <span className="dice-box__tirada">Jugada mínima a superar</span>
                      <span className="dice-box__beat">
                        {minHand.hand.desc}
                        <span className="dice-box__beat-who"> · {minHand.name}</span>
                      </span>
                    </>
                  ) : (
                    <span className="dice-box__tirada">
                      {rollNum > 0
                        ? `Tirada ${rollNum} de ${maxAllowed}`
                        : isMyTurn ? 'Tira los dados para empezar' : `Turno de ${currentPlayer?.name}`}
                    </span>
                  )}
                </div>
              </div>
            )
          })()}

          <div className="actions">
            {isMyTurn && !me?.done && (
              <>
                {mustPass ? (
                  <div className="actions__row">
                    <CountdownButton
                      className="btn--full"
                      deadline={room.turnDeadline}
                      totalMs={30_000}
                      onClick={handleStand}
                      disabled={isAnimating}
                    >
                      Pasar al siguiente jugador
                    </CountdownButton>
                  </div>
                ) : (
                  <>
                    <p className={`actions__hint ${timeLeft !== null && timeLeft <= 10 ? 'actions__hint--urgent' : ''}`}>
                      Toca los dados a descartar
                    </p>
                    <div className="actions__row">
                      <button className="btn btn--secondary" onClick={handleStand} disabled={rollCount === 0 || isAnimating}>
                        Plantarse
                      </button>
                      <CountdownButton
                        className="btn--primary"
                        deadline={room.turnDeadline}
                        totalMs={30_000}
                        onClick={handleRoll}
                        disabled={!canRoll || isAnimating}
                      >
                        Tirar dados
                      </CountdownButton>
                    </div>
                  </>
                )}
                {IS_MOBILE && needsMotionPermission() && !shakeEnabled && (
                  <button className="btn btn--secondary btn--full" onClick={enableShakeIOS} style={{ marginTop: 8 }}>
                    Activar agitar
                  </button>
                )}
              </>
            )}
            {me?.done && (
              <p className="waiting-label">
                {`Tu mano: ${me?.hand?.desc}`}
                {me?.hand?.rank != null && <span className="dice-box__hand-pts">+{handPts(me.hand.rank)} B</span>}
              </p>
            )}
            {!isMyTurn && !me?.done && waitTimeLeft !== null && (
              <p className={`actions__wait-label${waitTimeLeft <= 10 ? ' actions__hint--urgent' : ''}`}>
                Esperando la tirada del otro jugador ({waitTimeLeft}s)
              </p>
            )}
          </div>
          </div>
        </div>
      )}

      {/* Banner inferior — spacer nativo o AdSense web */}
      {IS_NATIVE
        ? <div style={{ height: 60, flexShrink: 0 }} />
        : (
          <div className="gameboard__ad-bottom">
            <ins
              className="adsbygoogle"
              style={{ display: 'block' }}
              data-ad-client="ca-pub-4894674675461010"
              data-ad-slot="3712072343"
              data-full-width-responsive="true"
              data-ad-format="banner"
            />
          </div>
        )
      }

      {nextPlayerVisible && (
        <AnimacionNextPlayer
          room={room}
          isMyTurn={isMyTurn}
          closing={!awaitingContinue}
          onContinue={() => socket.emit('continue_turn')}
          onDone={() => setNextPlayerVisible(false)}
        />
      )}

      {leaveIntent && (
        <div className="modal-overlay">
          <div className="modal" role="alertdialog" aria-modal="true">
            <h2 className="modal__title">Abandonar la partida</h2>
            <p className="modal__text">¿Estás seguro de que quieres abandonar la partida?</p>
            <p className="modal__text modal__text--warning">La puntuación acumulada en esta partida se perderá.</p>
            <div className="modal__actions">
              <button className="btn btn--secondary" onClick={() => setLeaveIntent(null)}>Seguir jugando</button>
              <button className="btn btn--primary" onClick={confirmLeave}>Abandonar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
