import { useEffect, useRef } from 'react'

// Efecto manga de "speed lines" al sacar Póker/Repóker — speedlines-light.png
// (líneas oscuras) en modo Light, speedlines-dark.png (líneas blancas) en
// modo Dark (mismo criterio que DiceRollerScene para el fondo de la escena).
// Repóker añade además un temblor de pantalla (ver .dice-box--quake en
// index.css) y sustituye el texto por la imagen repoker.png, deslizando con
// la misma curva que la animación de cambio de turno (AnimacionNextPlayer:
// entra desde la izquierda, sale por la derecha), pero contenida dentro de
// la caja de dados en vez de a pantalla completa.
// Violinazo reutiliza esa misma mecánica (imagen + texto sobre los dados)
// pero sin las speed lines — ver justo después se encadena con la animación
// de cambio de turno (ver handleViolinazoDone en GameBoard.jsx).
function isDarkTheme() {
  const t = document.documentElement.getAttribute('data-theme')
  return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

const SOUNDS = {
  repoker: new Audio('/assets/repoker.mp3'),
  violinazo: new Audio('/assets/violinazo.mp3'),
}
function playHandSound(variant) {
  const a = SOUNDS[variant]
  if (!a) return
  a.currentTime = 0
  a.play().catch(() => {})
}
const style = `
@keyframes hb_flash {
  0%   { opacity: 0; }
  12%  { opacity: 0.85; }
  100% { opacity: 0; }
}
@keyframes hb_lines_in {
  0%   { opacity: 0; transform: scale(0.55) rotate(0deg); }
  10%  { opacity: 1;  transform: scale(1.05) rotate(1deg); }
  70%  { opacity: 1;  transform: scale(1) rotate(0deg); }
  100% { opacity: 0;  transform: scale(1.12) rotate(-0.5deg); }
}
@keyframes hb_img_slide {
  0%   { transform: translate(-50%, -50%) translateX(-170%); opacity: 0; }
  8%   { opacity: 1; }
  30%  { transform: translate(-50%, -50%) translateX(0); opacity: 1; }
  78%  { transform: translate(-50%, -50%) translateX(0); opacity: 1; }
  100% { transform: translate(-50%, -50%) translateX(170%); opacity: 1; }
}
.hb {
  position: absolute;
  inset: 0;
  z-index: 8;
  overflow: hidden;
  pointer-events: none;
}
.hb__flash {
  position: absolute;
  inset: 0;
  animation: hb_flash var(--hb-dur, 1100ms) ease-out forwards;
}
.hb__lines {
  position: absolute;
  inset: -25%;
  animation: hb_lines_in var(--hb-dur, 1100ms) cubic-bezier(.22,1,.36,1) forwards;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 9%, #000 26%, #000 68%, transparent 96%);
  mask-image: radial-gradient(circle at 50% 50%, transparent 9%, #000 26%, #000 68%, transparent 96%);
}
.hb__img {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(78%, 320px);
  filter: drop-shadow(0 6px 14px rgba(0,0,0,0.45));
  animation: hb_img_slide var(--hb-dur, 1500ms) cubic-bezier(.22,1,.36,1) forwards;
}
.hb__img--violinazo {
  width: min(55%, 210px);
}
.hb__img--remontada {
  width: min(80%, 340px);
}
@keyframes dice_box_quake {
  0%   { transform: translate(0,0) rotate(0deg); }
  10%  { transform: translate(-6px, 3px) rotate(-1deg); }
  20%  { transform: translate(5px, -4px) rotate(1deg); }
  30%  { transform: translate(-5px, 5px) rotate(-1deg); }
  40%  { transform: translate(6px, -3px) rotate(1deg); }
  50%  { transform: translate(-5px, 2px) rotate(-0.6deg); }
  60%  { transform: translate(4px, -5px) rotate(0.6deg); }
  70%  { transform: translate(-3px, 3px) rotate(-0.5deg); }
  80%  { transform: translate(3px, -2px) rotate(0.5deg); }
  90%  { transform: translate(-2px, 1px) rotate(0deg); }
  100% { transform: translate(0,0) rotate(0deg); }
}
.dice-box--quake { animation: dice_box_quake 650ms ease-in-out; }
`

const DURATION_MS = { poker: 1100, repoker: 1500, violinazo: 3400, remontada: 1600 } // violinazo: dura lo mismo que violinazo.mp3 (3.43s)

export default function HandBurstEffect({ variant, onDone }) {
  const duration = DURATION_MS[variant] ?? 1100
  // onDone llega como función inline desde GameBoard (identidad nueva en
  // cada render) — si entrara en las deps del efecto, cualquier re-render de
  // GameBoard durante los 3.4s del violinazo lo reiniciaba y repetía el
  // sonido. Con la ref solo se dispara al cambiar `variant`.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!variant) return
    playHandSound(variant)
    const t = setTimeout(() => onDoneRef.current?.(), duration)
    return () => clearTimeout(t)
  }, [variant, duration])

  if (!variant) return null

  const dark = isDarkTheme()
  const lineImg = dark ? '/assets/speedlines-dark.png' : '/assets/speedlines-light.png'
  const flashRgb = dark ? '0,0,0' : '255,255,255'

  return (
    <>
      <style>{style}</style>
      <div
        className={`hb${variant === 'repoker' ? ' hb--repoker' : ''}`}
        style={{ '--hb-dur': `${duration}ms` }}
      >
        <div
          className="hb__flash"
          style={{ background: `radial-gradient(circle at 50% 50%, rgba(${flashRgb},1) 0%, rgba(${flashRgb},1) 35%, rgba(${flashRgb},0) 72%)` }}
        />
        {variant !== 'violinazo' && (
          <div className="hb__lines" style={{ backgroundImage: `url(${lineImg})` }} />
        )}
        {variant === 'violinazo' ? (
          <img className="hb__img hb__img--violinazo" src="/assets/violinazo.png" alt="Violinazo" />
        ) : variant === 'remontada' ? (
          <img className="hb__img hb__img--remontada" src="/assets/remontada.png" alt="¡Remontada!" />
        ) : variant === 'repoker' ? (
          <img className="hb__img" src="/assets/repoker.png" alt="¡Repóker!" />
        ) : (
          <img className="hb__img" src="/assets/poker.png" alt="¡Póker!" />
        )}
      </div>
    </>
  )
}
