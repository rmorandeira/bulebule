import { useState, useEffect } from 'react'
import Die from './Die'

const VALUE_RANK = { AS: 6, K: 5, Q: 4, J: 3, '8': 2, '7': 1 }

function compareHands(h1, h2) {
  if (h1.rank !== h2.rank) return h1.rank - h2.rank
  if (h1.topKey && h2.topKey) return VALUE_RANK[h1.topKey] - VALUE_RANK[h2.topKey]
  if (h1.pairs && h2.pairs) {
    const d = VALUE_RANK[h1.pairs[0]] - VALUE_RANK[h2.pairs[0]]
    return d !== 0 ? d : VALUE_RANK[h1.pairs[1]] - VALUE_RANK[h2.pairs[1]]
  }
  return 0
}

const style = `
@keyframes animacion_next_player_in {
  from { transform: translateX(-110vw); }
  to   { transform: translateX(0); }
}
@keyframes animacion_next_player_out {
  from { transform: translateX(0); }
  to   { transform: translateX(110vw); }
}
`

// Velado de la partida + "JUGADOR SIGUIENTE" entrando de izquierda al centro,
// con la jugada a superar y un contador de 30s. El turno siguiente no empieza
// hasta pulsar Continuar (o agotarse el contador, que continúa solo).
export default function AnimacionNextPlayer({ room, closing, onContinue, onDone }) {
  const [exitPhase, setExitPhase] = useState(null) // null | 'out' | 'fade'
  const [secondsLeft, setSecondsLeft] = useState(null)

  useEffect(() => {
    if (closing && !exitPhase) setExitPhase('out')
  }, [closing, exitPhase])

  useEffect(() => {
    if (!room.continueDeadline) { setSecondsLeft(null); return }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((room.continueDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [room.continueDeadline])

  // Jugada a superar: la mejor mano de los jugadores ya plantados
  let toBeat = null
  for (const p of room.players) {
    if (p.done && p.hand && (!toBeat || compareHands(p.hand, toBeat.hand) > 0)) toBeat = p
  }

  return (
    <>
      <style>{style}</style>
      <div
        className={`next-player-overlay${exitPhase === 'fade' ? ' next-player-overlay--closing' : ''}`}
        onTransitionEnd={(e) => { if (exitPhase === 'fade' && e.target === e.currentTarget) onDone?.() }}
      >
        <div className="next-player-content">
          <img
            className="next-player-img"
            src="/assets/jugador-siguiente.png"
            alt="Jugador siguiente"
            style={{
              animation: exitPhase
                ? `animacion_next_player_out 450ms ease-in forwards`
                : `animacion_next_player_in 450ms ease-out forwards`,
            }}
            onAnimationEnd={() => { if (exitPhase === 'out') setExitPhase('fade') }}
          />
          {!exitPhase && toBeat && (
            <div className="next-player-hand">
              <p className="next-player-hand__title">Jugada a superar</p>
              <div className="next-player-hand__dice">
                {toBeat.currentDice?.map((v, i) => <Die key={i} value={v} />)}
              </div>
              <div className="next-player-hand__row">
                <span className="next-player-hand__name">{toBeat.hand.desc}</span>
                <span className="next-player-hand__rolls">
                  en {toBeat.rollCount} {toBeat.rollCount === 1 ? 'ronda' : 'rondas'}
                </span>
              </div>
            </div>
          )}
        </div>
        {!exitPhase && (
          <div className="next-player-footer">
            {secondsLeft !== null && (
              <span className={`next-player-counter${secondsLeft <= 10 ? ' next-player-counter--urgent' : ''}`}>
                {secondsLeft}s
              </span>
            )}
            <button className="btn btn--primary next-player-continue" onClick={onContinue}>
              Continuar
            </button>
          </div>
        )}
      </div>
    </>
  )
}
