export default function Die({ value, onDiscard, discarded = false, small = false, animDelay = null }) {
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
        disabled={!onDiscard || discarded}
        aria-label={`Dado ${value}${discarded ? ' (descartado)' : ''}`}
      >
        {value}
      </button>
    </div>
  )
}
