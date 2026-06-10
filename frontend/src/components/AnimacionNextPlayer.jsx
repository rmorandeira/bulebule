import { useState } from 'react'

const SLIDE_IN = 450
const SLIDE_OUT = 450

const style = `
@keyframes animacion_next_player_in {
  from { transform: translateX(-110vw); }
  to   { transform: translateX(-50%); }
}
@keyframes animacion_next_player_out {
  from { transform: translateX(-50%); }
  to   { transform: translateX(110vw); }
}
`

// Velado de la partida + "JUGADOR SIGUIENTE" entrando de izquierda al centro;
// al pulsar Continuar la imagen sale hacia la derecha y se pasa al siguiente jugador.
export default function AnimacionNextPlayer({ onDone }) {
  const [leaving, setLeaving] = useState(false)

  return (
    <>
      <style>{style}</style>
      <div className="next-player-overlay">
        <img
          className="next-player-img"
          src="/assets/jugador-siguiente.png"
          alt="Jugador siguiente"
          style={{
            animation: leaving
              ? `animacion_next_player_out ${SLIDE_OUT}ms ease-in forwards`
              : `animacion_next_player_in ${SLIDE_IN}ms ease-out forwards`,
          }}
          onAnimationEnd={() => { if (leaving) onDone?.() }}
        />
        {!leaving && (
          <button className="btn btn--primary next-player-continue" onClick={() => setLeaving(true)}>
            Continuar
          </button>
        )}
      </div>
    </>
  )
}
