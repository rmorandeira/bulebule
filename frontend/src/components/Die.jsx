import { useRef, useEffect } from 'react'

const SWIPE_THRESHOLD = 40

const DIE_CLASS = {
  'AS': 'die--as',
  'K':  'die--k',
  'Q':  'die--q',
  'J':  'die--j',
  '8':  'die--8',
  '7':  'die--7',
}

export default function Die({ value, onDiscard, discarded = false, small = false, animDelay = null }) {
  const btnRef = useRef(null)
  const onDiscardRef = useRef(onDiscard)

  useEffect(() => { onDiscardRef.current = onDiscard })

  useEffect(() => {
    const btn = btnRef.current
    if (!btn) return

    let startY = null

    function onTouchStart(e) { startY = e.touches[0].clientY }

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

  const displayValue = value === 'AS' ? 'A' : value

  const cls = [
    'die',
    DIE_CLASS[value],
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
        aria-label={`Dado ${displayValue}${discarded ? ' (descartado)' : ''}`}
      >
        <span className="die-letter">{displayValue}</span>
      </button>
    </div>
  )
}
