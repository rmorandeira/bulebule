import { useEffect } from 'react'

// Efecto manga de "speed lines" al sacar Póker/Repóker — siempre en blanco y
// negro (modo Light) para máximo contraste, independiente del tema de la app.
// Repóker añade además un temblor de pantalla (ver .dice-box--quake en
// index.css) y sustituye el texto por la imagen repoker.png, deslizando con
// la misma curva que la animación de cambio de turno (AnimacionNextPlayer:
// entra desde la izquierda, sale por la derecha), pero contenida dentro de
// la caja de dados en vez de a pantalla completa.
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
@keyframes hb_badge_pop {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.3) rotate(-10deg); }
  45%  { opacity: 1;  transform: translate(-50%, -50%) scale(1.18) rotate(-3deg); }
  60%  { opacity: 1;  transform: translate(-50%, -50%) scale(1) rotate(-3deg); }
  85%  { opacity: 1;  transform: translate(-50%, -50%) scale(1) rotate(-3deg); }
  100% { opacity: 0;  transform: translate(-50%, -50%) scale(1.08) rotate(-3deg); }
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
  background: radial-gradient(circle at 50% 50%, #fff 0%, #fff 35%, rgba(255,255,255,0) 72%);
  animation: hb_flash var(--hb-dur, 1100ms) ease-out forwards;
}
.hb__lines {
  position: absolute;
  inset: -25%;
  animation: hb_lines_in var(--hb-dur, 1100ms) cubic-bezier(.22,1,.36,1) forwards;
  background-image:
    repeating-conic-gradient(from 0deg at 50% 50%, rgba(10,10,10,0.92) 0deg 1deg, transparent 1deg 3.4deg),
    repeating-conic-gradient(from 12deg at 50% 50%, rgba(10,10,10,0.55) 0deg 0.7deg, transparent 0.7deg 5.6deg),
    repeating-conic-gradient(from 6deg at 50% 50%, rgba(10,10,10,0.3) 0deg 2deg, transparent 2deg 9deg);
  -webkit-mask-image: radial-gradient(circle at 50% 50%, transparent 9%, #000 26%, #000 68%, transparent 96%);
  mask-image: radial-gradient(circle at 50% 50%, transparent 9%, #000 26%, #000 68%, transparent 96%);
}
.hb__badge {
  position: absolute;
  left: 50%;
  top: 50%;
  animation: hb_badge_pop var(--hb-dur, 1100ms) cubic-bezier(.22,1,.36,1) forwards;
  font-family: Georgia, 'Times New Roman', serif;
  font-weight: 900;
  font-style: italic;
  font-size: clamp(26px, 8vw, 44px);
  letter-spacing: 1px;
  color: #0a0a0a;
  -webkit-text-stroke: 2px #fff;
  paint-order: stroke fill;
  text-shadow: 0 0 0 #fff, 3px 3px 0 #fff, -3px -3px 0 #fff, 3px -3px 0 #fff, -3px 3px 0 #fff;
  white-space: nowrap;
}
.hb__img {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(78%, 320px);
  filter: drop-shadow(0 6px 14px rgba(0,0,0,0.45));
  animation: hb_img_slide var(--hb-dur, 1500ms) cubic-bezier(.22,1,.36,1) forwards;
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

const DURATION_MS = { poker: 1100, repoker: 1500 }

export default function HandBurstEffect({ variant, onDone }) {
  const duration = DURATION_MS[variant] ?? 1100

  useEffect(() => {
    if (!variant) return
    const t = setTimeout(() => onDone?.(), duration)
    return () => clearTimeout(t)
  }, [variant, duration, onDone])

  if (!variant) return null

  return (
    <>
      <style>{style}</style>
      <div className={`hb${variant === 'repoker' ? ' hb--repoker' : ''}`} style={{ '--hb-dur': `${duration}ms` }}>
        <div className="hb__flash" />
        <div className="hb__lines" />
        {variant === 'repoker'
          ? <img className="hb__img" src="/assets/repoker.png" alt="¡Repóker!" />
          : <span className="hb__badge">¡PÓKER!</span>}
      </div>
    </>
  )
}
