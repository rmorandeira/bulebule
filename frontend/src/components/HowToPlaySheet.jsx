import { useSheetDrag } from '../hooks/useSheetDrag'

const HANDS = [
  { rank: 7, name: 'Repóker',       desc: 'Los 5 dados iguales' },
  { rank: 6, name: 'Póker',         desc: '4 dados iguales' },
  { rank: 5, name: 'Full',          desc: 'Un trío + una pareja' },
  { rank: 4, name: 'Escalera',      desc: '5 valores seguidos: As-K-Q-J-8 o K-Q-J-8-7' },
  { rank: 3, name: 'Trío',          desc: '3 dados iguales' },
  { rank: 2, name: 'Dobles parejas', desc: 'Dos parejas distintas' },
  { rank: 1, name: 'Pareja',        desc: '2 dados iguales' },
  { rank: 0, name: 'Carta alta',    desc: 'El dado más alto cuando no hay jugada' },
]

export default function HowToPlaySheet({ closing, onClose }) {
  const { sheetRef, handleProps } = useSheetDrag(onClose)

  return (
    <>
      <div className={`bs-overlay${closing ? ' bs-overlay--closing' : ''}`} onClick={onClose} />
      <div className={`bs${closing ? ' bs--closing' : ''}`} role="dialog" aria-modal="true" ref={sheetRef}>
        <div className="bs__handle" {...handleProps} />

        <p className="rules__heading">Cómo se juega a Bule Bule</p>

        <div className="rules__section">
          <p className="rules__section-title">OBJETIVO</p>
          <p className="rules__text">
            Sé el último jugador en pie. La partida se juega a rondas: quien pierde una ronda rompe
            un palillo, y al tercer palillo roto pierdes la partida ("haces capilla").
          </p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">LOS DADOS</p>
          <p className="rules__text">
            Tiras 5 dados especiales con las caras As, Rey (K), Reina (Q), Jota (J), Ocho y Siete,
            como una baraja de cartas.
          </p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">TU TURNO</p>
          <p className="rules__text">
            Tienes hasta 3 tiradas. Después de cada una eliges qué dados conservas y cuáles vuelves
            a tirar. El primer jugador de la ronda marca el ritmo: si para en 2 tiradas, el resto
            de jugadores de esa ronda también tiene como máximo 2.
          </p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">JUGADAS (de mayor a menor)</p>
          <div className="rules__hands">
            {HANDS.map(h => (
              <div key={h.rank} className="rules__hand">
                <span className="rules__hand-rank">{h.rank}</span>
                <div className="rules__hand-info">
                  <p className="rules__hand-name">{h.name}</p>
                  <p className="rules__hand-desc">{h.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">GANAR Y PERDER LA RONDA</p>
          <p className="rules__text">
            Gana la ronda quien se quede con la mejor jugada. Quien pierde rompe un palillo y abre
            la siguiente ronda. Si hay empate entre los mejores, se juega un desempate a la caída:
            una tirada extra solo entre los empatados.
          </p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">LIBERARTE</p>
          <p className="rules__text">
            Si sacas Repóker (los 5 dados iguales) quedas liberado: no vuelves a jugar en esa
            partida y esperas a que el resto se dispute quién pierde la ronda.
          </p>
        </div>

        <div className="rules__section">
          <p className="rules__section-title">BULES</p>
          <p className="rules__text">
            Jugando partidas online ganas Bules: cuanto mejor sea la jugada con la que cierras la
            ronda, más puntos consigues.
          </p>
        </div>

        <button className="bs__submit" onClick={onClose}>Entendido</button>
      </div>
    </>
  )
}
