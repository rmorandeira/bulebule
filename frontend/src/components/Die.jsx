import { useRef, useEffect } from 'react'

const SWIPE_THRESHOLD = 40

// 3×3 grid: 1 = dot present, 0 = empty cell
const PIP_PATTERNS = {
  'AS': [0,0,0, 0,1,0, 0,0,0],          // 1 pip  — rojo
  '7':  [1,1,1, 0,1,0, 1,1,1],          // 7 pips — negro
  '8':  [1,1,1, 1,1,1, 1,1,1],          // 8 pips — rojo (3×3 completo)
}
const RED_VALUES = new Set(['AS', '8', 'K'])

function DieFace({ value }) {
  if (value in PIP_PATTERNS) {
    const red = RED_VALUES.has(value)
    return (
      <div className="die-face-pips">
        {PIP_PATTERNS[value].map((on, i) =>
          on ? <div key={i} className={red ? 'pip pip--red' : 'pip'} /> : <div key={i} />
        )}
      </div>
    )
  }
  return (
    <span className={RED_VALUES.has(value) ? 'die-letter die-letter--red' : 'die-letter'}>
      {value}
    </span>
  )
}

export default function Die({ value, onDiscard, discarded = false, small = false, animDelay = null }) {
  const btnRef = useRef(null)
  const onDiscardRef = useRef(onDiscard)

  useEffect(() => { onDiscardRef.current = onDiscard })

  useEffect(() => {
    const btn = btnRef.current
    if (!btn) return

    let startY = null

    function onTouchStart(e) {
      startY = e.touches[0].clientY
    }

    function onTouchMove(e) {
      if (startY === null || !onDiscardRef.current) return
      const dy = Math.abs(e.touches[0].clientY - startY)
      if (dy > SWIPE_THRESHOLD) {
        startY = null
        e.preventDefault()
        onDiscardRef.current()
      }
    }

    function onTouchEnd() { startY = null }

    btn.addEventListener('touchstart', onTouchStart, { passive: true })
    btn.addEventListener('touchmove', onTouchMove, { passive: false })
    btn.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      btn.removeEventListener('touchstart', onTouchStart)
      btn.removeEventListener('touchmove', onTouchMove)
      btn.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const wrapperCls = ['die-wrapper', discarded && 'die-wrapper--collapsing', animDelay !== null ? 'die-wrapper--animated' : ''].filter(Boolean).join(' ')
  const wrapperStyle = animDelay !== null ? { animationDelay: `${animDelay}ms` } : {}

  const cls = [
    'die',
    small && 'die--small',
    onDiscard && !discarded && 'die--interactive',
    discarded && 'die--discarding',
  ].filter(Boolean).join(' ')

  return (
    <div className={wrapperCls} style={wrapperStyle}>
      <button
        ref={btnRef}
        className={cls}
        onClick={!discarded ? onDiscard ?? undefined : undefined}
        disabled={!onDiscard || discarded}
        aria-label={`Dado ${value}${discarded ? ' (descartado)' : ''}`}
      >
        <DieFace value={value} />
      </button>
    </div>
  )
}
