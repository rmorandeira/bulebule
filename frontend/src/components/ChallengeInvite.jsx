import { useEffect, useRef } from 'react'
import CountdownButton from './CountdownButton'

const AUTO_DISMISS_MS = 12_000

export default function ChallengeInvite({ invite, onAccept, onDecline }) {
  const deadlineRef = useRef(Date.now() + AUTO_DISMISS_MS)

  useEffect(() => {
    const t = setTimeout(onDecline, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="chi">
      <div className="chi__icon">⚔️</div>
      <div className="chi__body">
        <p className="chi__title">{invite.inviterName} te reta</p>
        <p className="chi__sub">¿Aceptas el reto?</p>
      </div>
      <div className="chi__actions">
        <button className="chi__btn chi__btn--decline" onClick={onDecline}>✕</button>
        <CountdownButton
          className="chi__btn chi__btn--accept btn--primary"
          deadline={deadlineRef.current}
          totalMs={AUTO_DISMISS_MS}
          onClick={onAccept}
        >
          Aceptar
        </CountdownButton>
      </div>
    </div>
  )
}
