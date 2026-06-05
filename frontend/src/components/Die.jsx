export default function Die({ value, selected, onClick, small = false }) {
  const cls = [
    'die',
    small ? 'die--small' : '',
    selected ? 'die--selected' : '',
    onClick ? 'die--interactive' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="die-wrapper">
      <button className={cls} onClick={onClick} disabled={!onClick} aria-label={`Dado ${value}${selected ? ' (descartado)' : ''}`}>
        {value}
      </button>
      {selected && <span className="die-dot" />}
    </div>
  )
}
