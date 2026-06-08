import { useRef, useEffect } from 'react'

const SWIPE_THRESHOLD = 40

export default function Die({ value, onDiscard, discarded = false, small = false, animDelay = null }) {
  const btnRef = useRef(null)
  const onDiscardRef = useRef(onDiscard)

  // Keep ref current so the native listener always calls the latest onDiscard
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
        e.preventDefault() // prevent scroll + prevent click from firing
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

  const wrapperCls = ['die-wrapper', animDelay !== null ? 'die-wrapper--animated' : ''].filter(Boolean).join(' ')
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
        {value}
      </button>
    </div>
  )
}
