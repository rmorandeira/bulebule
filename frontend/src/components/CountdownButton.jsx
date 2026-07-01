import { useLayoutEffect, useEffect, useRef, useState } from 'react'

export default function CountdownButton({
  deadline,
  totalMs = 30_000,
  onClick,
  disabled,
  className = '',
  children,
}) {
  const [animKey, setAnimKey]     = useState(0)
  const [animStyle, setAnimStyle] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(null)
  const prevDeadline = useRef(null)

  useLayoutEffect(() => {
    if (!deadline || !totalMs) { setAnimStyle(null); return }
    if (deadline === prevDeadline.current) return
    prevDeadline.current = deadline
    const elapsed = Math.max(0, totalMs - (deadline - Date.now()))
    setAnimStyle({ animationDuration: `${totalMs}ms`, animationDelay: `-${elapsed}ms` })
    setAnimKey(k => k + 1)
  }, [deadline, totalMs])

  useEffect(() => {
    if (!deadline) { setSecondsLeft(null); return }
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    update()
    const id = setInterval(update, 500)
    return () => clearInterval(id)
  }, [deadline])

  return (
    <button
      className={`btn-cd ${animStyle ? 'btn-cd--active' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {animStyle && <span key={animKey} className="btn-cd__fill" style={animStyle} />}
      <span className="btn-cd__label">
        {children}{secondsLeft !== null ? ` (${secondsLeft}s)` : ''}
      </span>
    </button>
  )
}
