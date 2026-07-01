import { useState, useEffect, useRef } from 'react'
import Die from './Die'
import { IS_NATIVE, showBanner, removeBanner } from '../utils/admob'
import CountdownButton from './CountdownButton'

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

function PalilloMini({ player }) {
  if (!player) return null
  if (player.liberado) return <span className="tag tag--liberado" style={{ fontSize: 10 }}>Lib</span>
  if ((player.breaks ?? 0) >= 3) return <span className="tag tag--capilla" style={{ fontSize: 10 }}>Cap</span>
  const breaks = player.breaks ?? 0
  return (
    <span className="palillo">
      {[0, 1, 2].map(i => (
        <span key={i} className={i < 3 - breaks ? 'palillo__seg' : 'palillo__seg palillo__seg--roto'} />
      ))}
    </span>
  )
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

function AdTop() {
  useEffect(() => {
    if (IS_NATIVE) {
      showBanner('TOP_CENTER')
      return () => removeBanner()
    }
    // Web: AdSense
    try { ;(window.adsbygoogle = window.adsbygoogle || []).push({}) } catch (e) {}
  }, [])

  if (IS_NATIVE) return null

  return (
    <div className="next-player-ad">
      <ins
        className="adsbygoogle"
        style={{ display: 'inline-block', width: '728px', height: '90px', maxWidth: '100%' }}
        data-ad-client="ca-pub-4894674675461010"
        data-ad-slot="3916695286"
      />
    </div>
  )
}

export default function AnimacionNextPlayer({ room, isMyTurn, closing, onContinue, onDone }) {
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

  const currentPlayer = room.players[room.currentPlayerIndex]

  // Jugada a superar: la mejor mano de los jugadores ya plantados
  let toBeat = null
  for (const p of room.players) {
    if (p.done && p.hand && (!toBeat || compareHands(p.hand, toBeat.hand) < 0)) toBeat = p
  }

  return (
    <>
      <style>{style}</style>
      <div
        className={`next-player-overlay${exitPhase === 'fade' ? ' next-player-overlay--closing' : ''}`}
        onTransitionEnd={(e) => { if (exitPhase === 'fade' && e.target === e.currentTarget) onDone?.() }}
      >
        {!exitPhase && <AdTop />}
        <div className="next-player-content">
          <img
            className="next-player-img"
            src={isMyTurn ? '/assets/jugador-siguiente.png' : '/assets/turno-de.png'}
            alt={isMyTurn ? 'És tu turno' : 'És el turno de...'}
            style={{
              animation: exitPhase
                ? `animacion_next_player_out 450ms ease-in forwards`
                : `animacion_next_player_in 450ms ease-out forwards`,
            }}
            onAnimationEnd={() => { if (exitPhase === 'out') setExitPhase('fade') }}
          />
          {!exitPhase && currentPlayer && (
            <div className="next-player-name-pill">
              <span className="next-player-name-pill__name">{currentPlayer.name}</span>
              <PalilloMini player={currentPlayer} />
            </div>
          )}
          {!exitPhase && toBeat && (
            <div className="next-player-hand">
              <p className="next-player-hand__title">Superar</p>
              <div className="next-player-hand__dice">
                {[...(toBeat.currentDice ?? [])].sort((a, b) => (VALUE_RANK[b] ?? 0) - (VALUE_RANK[a] ?? 0)).map((v, i) => <Die key={i} value={v} skin={toBeat.diceSkin} />)}
              </div>
              <span className="next-player-hand__name">{toBeat.hand.desc}</span>
              <span className="next-player-hand__rolls">
                en {toBeat.rollCount} {toBeat.rollCount === 1 ? 'tirada' : 'tiradas'}
              </span>
            </div>
          )}
        </div>
        {!exitPhase && !isMyTurn && (
          <div className="next-player-footer next-player-footer--waiting">
            <span className={`next-player-waiting${secondsLeft !== null && secondsLeft <= 10 ? ' next-player-counter--urgent' : ''}`}>
              {secondsLeft !== null
                ? `Esperando al otro jugador (${secondsLeft}s)`
                : 'Esperando al otro jugador'}
            </span>
          </div>
        )}
        {!exitPhase && isMyTurn && (
          <div className="next-player-footer">
            <CountdownButton
              className="btn--primary next-player-continue"
              deadline={room.continueDeadline}
              totalMs={30_000}
              onClick={onContinue}
            >
              Continuar
            </CountdownButton>
          </div>
        )}
      </div>
    </>
  )
}
