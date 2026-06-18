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

export default function AnimacionPalilloRoto({ room, onDone }) {
  const [exitPhase, setExitPhase] = useState(null)

  useEffect(() => {
    const id = setTimeout(() => setExitPhase('out'), 3000)
    return () => clearTimeout(id)
  }, [])

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
        </div>
      </div>
    </>
  )
}
