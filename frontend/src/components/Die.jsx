const PIP_PATTERNS = {
  'AS': [0,0,0, 0,1,0, 0,0,0],  // 1 pip centro — rojo
  '8':  [1,1,1, 0,1,1, 1,1,1],  // 8 pips — rojo
  '7':  [1,1,1, 0,1,0, 1,1,1],  // 7 pips — negro
}

function DieFace({ value }) {
  if (value in PIP_PATTERNS) {
    const red = value === 'AS' || value === '8'
    return (
      <div className="die-face-pips">
        {PIP_PATTERNS[value].map((on, i) =>
          on ? <div key={i} className={red ? 'pip pip--red' : 'pip'} /> : <div key={i} />
        )}
      </div>
    )
  }
  const display = value === 'AS' ? 'A' : value
  const red = value === 'K'
  return (
    <span className={red ? 'die-letter die-letter--red' : 'die-letter'}>
      {display}
    </span>
  )
}

export default function Die({ value, small = false }) {
  return (
    <div className="die-wrapper">
      <div className={small ? 'die die--small' : 'die'} aria-label={`Dado ${value}`}>
        <DieFace value={value} />
      </div>
    </div>
  )
}
