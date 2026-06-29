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

const SKIN_CLASS = {
  'dice-marble':       'die--marble',
  'dice-marble-black': 'die--marble-black',
  'dice-marble-red':   'die--marble-red',
  'dice-marble-green': 'die--marble-green',
}

export default function Die({ value, small = false }) {
  const skinClass = SKIN_CLASS[localStorage.getItem('bule_dice_skin')] ?? ''
  return (
    <div className="die-wrapper">
      <div
        className={`die${small ? ' die--small' : ''}${skinClass ? ` ${skinClass}` : ''}`}
        aria-label={`Dado ${value}`}
      >
        <DieFace value={value} />
      </div>
    </div>
  )
}
