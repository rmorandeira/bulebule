import { useState, useEffect } from 'react'

const style = `
@keyframes animacion_palillo_roto_in {
  from { transform: translateX(-110vw); }
  to   { transform: translateX(0); }
}
@keyframes animacion_palillo_roto_out {
  from { transform: translateX(0); }
  to   { transform: translateX(110vw); }
}
`

// Al final de cada ronda: velado + quién rompe el palillo, con la misma
// animación que el cambio de jugador (entra de izquierda, sale a la derecha).
export default function AnimacionPalilloRoto({ room, onDone, continueDeadline }) {
  const [exitPhase, setExitPhase] = useState(null) // null | 'out' | 'fade'
  const [secondsLeft, setSecondsLeft] = useState(null)

  useEffect(() => {
    if (!continueDeadline) { setSecondsLeft(null); return }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((continueDeadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [continueDeadline])

  const loser = room.players.find(p => p.id === (room.gameLoserId ?? room.roundLoserId))
  if (!loser) return null

  const esGameLoser = room.gameLoserId === loser.id
  const enCapilla = !esGameLoser && loser.breaks >= 3
  // Segmentos intactos primero; el recién roto es el primero de los rotos
  const justBrokenIdx = esGameLoser ? -1 : 3 - loser.breaks

  return (
    <>
      <style>{style}</style>
      <div
        className={`next-player-overlay${exitPhase === 'fade' ? ' next-player-overlay--closing' : ''}`}
        onTransitionEnd={(e) => { if (exitPhase === 'fade' && e.target === e.currentTarget) onDone?.() }}
      >
        <div
          className="palillo-roto"
          style={{
            animation: exitPhase
              ? `animacion_palillo_roto_out 450ms ease-in forwards`
              : `animacion_palillo_roto_in 450ms ease-out forwards`,
          }}
          onAnimationEnd={(e) => {
            if (exitPhase === 'out' && e.target === e.currentTarget) setExitPhase('fade')
          }}
        >
          <div className="palillo-roto__sticks">
            {[0, 1, 2].map(i => {
              const intact = !esGameLoser && i < 3 - loser.breaks
              const just = i === justBrokenIdx
              return (
                <span
                  key={i}
                  className={[
                    'palillo-roto__seg',
                    !intact && !just && 'palillo-roto__seg--roto',
                    just && 'palillo-roto__seg--just',
                  ].filter(Boolean).join(' ')}
                />
              )
            })}
          </div>
          <h2 className="palillo-roto__name">{loser.name}</h2>
          <p className="palillo-roto__text">
            {esGameLoser
              ? room.endReason === 'liberado'
                ? 'pierde la partida · el rival consiguió un Repóker'
                : 'pierde la partida estando en capilla'
              : 'rompe un palillo'}
          </p>
          {enCapilla && <p className="palillo-roto__capilla">¡Queda en capilla!</p>}
        </div>
        {!exitPhase && (
          <div className="next-player-footer">
            <button className="btn btn--primary next-player-continue" onClick={() => setExitPhase('out')}>
              {secondsLeft !== null ? `Continuar (${secondsLeft}s)` : 'Continuar'}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
