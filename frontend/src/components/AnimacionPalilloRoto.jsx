import { useState, useEffect } from 'react'

const style = `
@keyframes palillo_roto_inline_in {
  from { transform: translateX(-110%); }
  to   { transform: translateX(0); }
}
@keyframes palillo_roto_inline_out {
  from { transform: translateX(0); }
  to   { transform: translateX(110%); }
}
`

export default function AnimacionPalilloRoto({ room, isLoser, onDone, continueDeadline }) {
  const [exitPhase, setExitPhase] = useState(null) // null | 'out'
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
  const justBrokenIdx = esGameLoser ? -1 : 3 - loser.breaks

  return (
    <>
      <style>{style}</style>
      <div className="palillo-roto-inline">
        <div
          className="palillo-roto-inline__card"
          style={{
            animation: exitPhase
              ? `palillo_roto_inline_out 350ms ease-in forwards`
              : `palillo_roto_inline_in 350ms ease-out forwards`,
          }}
          onAnimationEnd={(e) => {
            if (exitPhase === 'out' && e.target === e.currentTarget) onDone?.()
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
          <p className="palillo-roto-inline__name">{loser.name}</p>
          <p className="palillo-roto-inline__text">
            {esGameLoser
              ? room.endReason === 'liberado'
                ? 'pierde la partida · el rival consiguió un Repóker'
                : 'pierde la partida estando en capilla'
              : 'rompe un palillo'}
          </p>
          {enCapilla && <p className="palillo-roto__capilla">¡Queda en capilla!</p>}
          {!exitPhase && isLoser && (
            <button className="btn btn--primary btn--full" style={{ marginTop: 12 }} onClick={() => setExitPhase('out')}>
              {secondsLeft !== null ? `Continuar (${secondsLeft}s)` : 'Continuar'}
            </button>
          )}
          {!exitPhase && !isLoser && (
            <p className="waiting-label" style={{ marginTop: 8 }}>
              {secondsLeft !== null ? `Esperando al jugador (${secondsLeft}s)` : 'Esperando al jugador...'}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
