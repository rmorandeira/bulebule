import { useEffect, useRef } from 'react'

const SLIDE_IN = 450
const HOLD = 1400
const SLIDE_OUT = 450
const TOTAL = SLIDE_IN + HOLD + SLIDE_OUT

const pIn = (SLIDE_IN / TOTAL * 100).toFixed(2)
const pOut = (( SLIDE_IN + HOLD) / TOTAL * 100).toFixed(2)

const style = `
@keyframes alaCaida {
  0%          { transform: translateX(-110vw); }
  ${pIn}%     { transform: translateX(-50%); animation-timing-function: linear; }
  ${pOut}%    { transform: translateX(-50%); animation-timing-function: ease-in; }
  100%        { transform: translateX(110vw); }
}
`

export default function AlaCaidaToast({ onDone }) {
  const onDoneRef = useRef(onDone)
  useEffect(() => { onDoneRef.current = onDone }, [onDone])

  useEffect(() => {
    const t = setTimeout(() => onDoneRef.current?.(), TOTAL)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      <style>{style}</style>
      <div style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 1000,
        overflow: 'hidden',
      }}>
        <img
          src="/assets/ala-caida.png"
          alt="A la caida neno"
          style={{
            width: 320,
            maxWidth: '80vw',
            position: 'absolute',
            left: '50%',
            animation: `alaCaida ${TOTAL}ms ease-out forwards`,
          }}
        />
      </div>
    </>
  )
}
