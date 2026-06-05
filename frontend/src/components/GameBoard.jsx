import { useState } from 'react'
import socket from '../socket'
import Die from './Die'

export default function GameBoard({ room, myId, onLeave }) {
  const [discardIndices, setDiscardIndices] = useState([])
  const [rolling, setRolling] = useState(false)

  const currentPlayer = room.players[room.currentPlayerIndex]
  const isMyTurn = currentPlayer?.id === myId
  const me = room.players.find(p => p.id === myId)
  const maxAllowed = room.maxRolls ?? 3
  const canRoll = isMyTurn && !me?.done && (me?.rollCount ?? 0) < maxAllowed
  const mustPass = isMyTurn && !me?.done && (me?.rollCount ?? 0) >= maxAllowed

  function toggleDiscard(i) {
    setDiscardIndices(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])
  }

  function handleRoll() {
    const diceCount = me?.currentDice?.length ?? 5
    const keptIndices = Array.from({ length: diceCount }, (_, i) => i).filter(i => !discardIndices.includes(i))
    setDiscardIndices([])
    setRolling(true)
    socket.emit('roll', { keptIndices }, (res) => {
      setRolling(false)
      if (!res?.ok && res?.error) alert(res.error)
    })
  }

  function handleStand() {
    socket.emit('stand', (res) => {
      if (!res?.ok && res?.error) alert(res.error)
    })
  }

  function handleNextRound() {
    socket.emit('next_round')
  }

  const displayPlayer = isMyTurn ? me : currentPlayer
  const allRolls = displayPlayer
    ? [...displayPlayer.rollHistory, ...(displayPlayer.rollCount > 0 ? [displayPlayer.currentDice] : [])]
    : []

  return (
    <div className="screen game">

      {/* Navbar persistente */}
      <nav className="navbar">
        <button className="navbar__exit" onClick={onLeave}>← Salir</button>
        <span className="navbar__round">Ronda {room.roundNumber}</span>
      </nav>

      {/* ── Pantalla de resultados ── */}
      {room.phase === 'results' ? (() => {
        const winner = room.players.find(p => p.id === room.roundWinnerId)
        const sorted = [...room.players].sort((a, b) => b.wins - a.wins)
        return (
          <>
            <div className="results__winner">
              <h2 className="results__name">{winner?.name}</h2>
              <p className="results__hand">{winner?.hand?.desc}</p>
            </div>

            <div className="results__hands">
              {room.players.map(p => (
                <div key={p.id} className={`results__row ${p.id === room.roundWinnerId ? 'results__row--winner' : ''}`}>
                  <span className="results__player">{p.name}</span>
                  <div className="results__dice">
                    {p.currentDice.map((v, i) => <Die key={i} value={v} small />)}
                  </div>
                  <span className="results__desc">{p.hand?.desc}</span>
                </div>
              ))}
            </div>

            <div className="results__scores">
              <p className="results__scores-title">Clasificación</p>
              {sorted.map((p, i) => (
                <div key={p.id} className="results__score-row">
                  <span className="results__pos">{i + 1}.</span>
                  <span className="results__sname">{p.name}</span>
                  <span className="results__wins">{p.wins} {p.wins === 1 ? 'victoria' : 'victorias'}</span>
                </div>
              ))}
            </div>

            {room.hostId === myId ? (
              <button className="btn btn--primary btn--full" onClick={handleNextRound}>Nueva ronda</button>
            ) : (
              <p className="waiting-label">Esperando al host...</p>
            )}
          </>
        )
      })() : (
      /* ── Pantalla de juego ── */
      <>
        {/* Scoreboard */}
        <div className="scoreboard">
          <p className="scoreboard__title">Clasificación</p>
          {[...room.players]
            .sort((a, b) => b.wins - a.wins)
            .map((p, i) => (
              <div key={p.id} className={`scoreboard__row ${p.id === currentPlayer?.id ? 'scoreboard__row--active' : ''}`}>
                <span className="scoreboard__pos">{i + 1}.</span>
                <span className="scoreboard__name">{p.name}{p.id === myId ? ' (tú)' : ''}</span>
                <div className="scoreboard__dice">
                  {p.currentDice.map((v, j) => <Die key={j} value={v} small />)}
                </div>
                <span className="scoreboard__wins">{p.wins}</span>
              </div>
            ))}
        </div>

        {/* Turn label */}
        {!isMyTurn && (
          <div className="turn-label">Turno de <strong>{currentPlayer?.name}</strong></div>
        )}

        {/* Roll history */}
        <div className="rolls">
          {allRolls.map((dice, rollIdx) => {
            const isCurrentRoll = rollIdx === allRolls.length - 1
            const isInteractive = isCurrentRoll && isMyTurn && !me?.done && canRoll

            return (
              <div key={rollIdx} className="roll">
                <span className="roll__label">Tirada {rollIdx + 1}</span>
                {isInteractive && (
                  <p className="roll__hint">Selecciona los dados a descartar</p>
                )}
                <div className="roll__dice">
                  {dice.map((val, dieIdx) => (
                    <Die
                      key={dieIdx}
                      value={val}
                      selected={isInteractive && discardIndices.includes(dieIdx)}
                      onClick={isInteractive ? () => toggleDiscard(dieIdx) : null}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {displayPlayer?.rollCount === 0 && (
            <p className="roll__pending">
              {isMyTurn ? 'Tira los dados para empezar' : `${currentPlayer?.name} aún no ha tirado`}
            </p>
          )}

          {displayPlayer?.done && displayPlayer?.hand && (
            <div className="hand-result">{displayPlayer.hand.desc}</div>
          )}
        </div>

        {/* Actions */}
        <div className="actions">
          {isMyTurn && !me?.done && (
            <>
              {me?.rollCount === 0 && (
                <button className="btn btn--primary btn--full" onClick={handleRoll} disabled={rolling}>
                  Tirar dados
                </button>
              )}
              {me?.rollCount > 0 && mustPass && (
                <button className="btn btn--primary btn--full" onClick={handleStand} disabled={rolling}>
                  Pasar turno
                </button>
              )}
              {me?.rollCount > 0 && !mustPass && (
                <>
                  <button className="btn btn--secondary" onClick={handleStand}>Plantarse</button>
                  <button className="btn btn--primary" onClick={handleRoll} disabled={rolling}>Tirar dados</button>
                </>
              )}
            </>
          )}
          {(!isMyTurn || me?.done) && (
            <p className="waiting-label">
              {me?.done ? `Tu mano: ${me?.hand?.desc}` : `Esperando a ${currentPlayer?.name}...`}
            </p>
          )}
        </div>
      </>
      )}
    </div>
  )
}
