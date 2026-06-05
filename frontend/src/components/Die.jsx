export default function Die({ value, selected, onClick, small = false, animDelay = null }) {
  const cls = [
    'die',
    small ? 'die--small' : '',
    selected ? 'die--selected' : '',
    onClick ? 'die--interactive' : '',
  ].filter(Boolean).join(' ')

  const wrapperCls = ['die-wrapper', animDelay !== null ? 'die-wrapper--animated' : ''].filter(Boolean).join(' ')
  const wrapperStyle = animDelay !== null ? { animationDelay: `${animDelay}ms` } : {}

  return (
    <div className={wrapperCls} style={wrapperStyle}>
      <button className={cls} onClick={onClick} disabled={!onClick} aria-label={`Dado ${value}${selected ? ' (descartado)' : ''}`}>
        {value}
      </button>
      {selected && <span className="die-dot" />}
    </div>
  )
}
