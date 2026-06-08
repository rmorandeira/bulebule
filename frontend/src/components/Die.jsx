import { useRef } from 'react'

const SWIPE_THRESHOLD = 40

export default function Die({ value, onDiscard, discarded = false, small = false, animDelay = null }) {
  const touchStartY = useRef(null)

  function handleTouchStart(e) {
    if (!onDiscard) return
    touchStartY.current = e.touches[0].clientY
  }

  function handleTouchMove(e) {
    if (!onDiscard || touchStartY.current === null) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > SWIPE_THRESHOLD) {
      touchStartY.current = null
      onDiscard()
    }
  }

  function handleTouchEnd() {
    touchStartY.current = null
  }

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
        className={cls}
        onClick={!discarded ? onDiscard ?? undefined : undefined}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        disabled={!onDiscard || discarded}
        aria-label={`Dado ${value}${discarded ? ' (descartado)' : ''}`}
      >
        {value}
      </button>
    </div>
  )
}
