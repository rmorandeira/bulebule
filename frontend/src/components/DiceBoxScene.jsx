import { useEffect, useRef, useCallback, useState } from 'react'
import DiceBox from '@3d-dice/dice-box'
import { stopDiceRoll } from '../sounds'

const RED_VALUES = new Set(['AS', 'K', '8'])
let instanceCounter = 0

export default function DiceBoxScene({
  dice = [],
  rolledIndices = null,
  keptIndices = [],
  interactive = false,
  onKeep,
  onSettled,
}) {
  const containerIdRef = useRef(`dice-box-${++instanceCounter}`)
  const boxRef = useRef(null)
  const readyRef = useRef(false)
  const pendingRollRef = useRef(null)
  const prevDiceKeyRef = useRef(null)
  const settleTimerRef = useRef(null)

  // Refs para acceder a valores actuales desde closures del init
  const diceRef = useRef(dice)
  const rolledIndicesRef = useRef(rolledIndices)
  const onSettledRef = useRef(onSettled)
  useEffect(() => { diceRef.current = dice }, [dice])
  useEffect(() => { rolledIndicesRef.current = rolledIndices }, [rolledIndices])
  useEffect(() => { onSettledRef.current = onSettled }, [onSettled])

  const [phase, setPhase] = useState('rolling')
  const [settledItems, setSettledItems] = useState([])
  const [exitingIndices, setExitingIndices] = useState([])

  // Calcula qué items mostrar a partir de dados y qué índices se lanzaron
  const computeItems = (diceArr, rolled) =>
    rolled === null
      ? diceArr.map((value, i) => ({ value, fullIndex: i }))
      : rolled.map(i => ({ value: diceArr[i], fullIndex: i }))

  // Llamado tanto por onRollComplete como por el timer de seguridad
  const doSettle = useCallback(() => {
    clearTimeout(settleTimerRef.current)
    const items = computeItems(diceRef.current, rolledIndicesRef.current)
    stopDiceRoll(300)
    setSettledItems(items)
    setPhase('settled')
    onSettledRef.current?.()
  }, [])

  // ── Init dice-box ────────────────────────────────────────────────────────────
  useEffect(() => {
    const id = containerIdRef.current

    const tryInit = (offscreen) => new DiceBox({
      container: `#${id}`,
      assetPath: '/assets/dice-box/',
      origin: window.location.origin,
      gravity: 5,
      mass: 4,
      friction: 1,
      restitution: 0,
      linearDamping: 0.6,
      angularDamping: 0.4,
      spinForce: 6,
      throwForce: 5,
      startingHeight: 3,
      settleTimeout: 4000,
      delay: 10,
      scale: 8,
      theme: 'smooth-pip',
      themeColor: '#E4D9C3',
      enableShadows: false,
      shadowTransparency: 0.81,
      lightIntensity: 1.0,
      offscreen,
      onRollComplete: () => doSettle(),
    })

    const afterInit = (instance) => {
      boxRef.current = instance
      readyRef.current = true
      window.dispatchEvent(new Event('resize'))
      if (pendingRollRef.current) {
        instance.roll(pendingRollRef.current)
        pendingRollRef.current = null
      }
    }

    const box = tryInit(true)
    box.init()
      .then(() => afterInit(box))
      .catch(() => {
        const fallback = tryInit(false)
        fallback.init().then(() => afterInit(fallback))
      })

    return () => {
      clearTimeout(settleTimerRef.current)
      readyRef.current = false
      boxRef.current = null
    }
  }, [doSettle])

  // ── Lanzar tirada cuando cambian los dados ───────────────────────────────────
  useEffect(() => {
    if (!dice.length) return
    const diceKey = dice.join(',')
    if (diceKey === prevDiceKeyRef.current) return
    prevDiceKeyRef.current = diceKey

    const items = computeItems(dice, rolledIndices)
    const count = items.length
    if (count === 0) return

    setPhase('rolling')
    setExitingIndices([])
    // settledItems se actualiza cuando los dados se asentan (en doSettle)

    // Timer de seguridad: si onRollComplete no llega, forzar el settle
    clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(doSettle, 5000)

    const notation = `${count}d6`
    if (readyRef.current && boxRef.current) {
      boxRef.current.clear()
      boxRef.current.roll(notation)
    } else {
      pendingRollRef.current = notation
    }
  }, [dice, rolledIndices, doSettle])

  // Si el usuario desguarda un dado, quitarlo de exitingIndices para que reaparezca
  useEffect(() => {
    setExitingIndices(prev => prev.filter(i => keptIndices.includes(i)))
  }, [keptIndices])

  // ── Guardar dado ─────────────────────────────────────────────────────────────
  const handleKeep = useCallback((i) => {
    if (!interactive || !onKeep) return
    if (keptIndices.includes(i)) return
    if (exitingIndices.includes(i)) return
    setExitingIndices(prev => [...prev, i])
    onKeep(i)
  }, [interactive, onKeep, keptIndices, exitingIndices])

  const touchDieRef = useRef(null)
  function onDieTouchStart(i, e) {
    touchDieRef.current = { i, y: e.touches[0].clientY }
  }
  function onDieTouchMove(e) {
    if (!touchDieRef.current) return
    const dy = e.touches[0].clientY - touchDieRef.current.y
    if (dy > 40) {
      handleKeep(touchDieRef.current.i)
      touchDieRef.current = null
    }
  }
  function onDieTouchEnd() { touchDieRef.current = null }

  // ── Render ───────────────────────────────────────────────────────────────────
  const visibleItems = phase === 'settled'
    ? settledItems.filter(({ fullIndex }) =>
        !keptIndices.includes(fullIndex) || exitingIndices.includes(fullIndex)
      )
    : []

  const slotCount = settledItems.length || 1
  const getLeft = (fullIndex) => {
    const slot = settledItems.findIndex(item => item.fullIndex === fullIndex)
    return `${((slot + 0.5) / slotCount) * 100}%`
  }

  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: 16 }}>
      <style>{`
        #${containerIdRef.current} { position: relative; }
        #${containerIdRef.current} canvas {
          position: absolute !important;
          top: 0 !important; left: 0 !important;
          width: 100% !important; height: 100% !important;
          display: block;
        }
      `}</style>

      <div
        id={containerIdRef.current}
        style={{
          width: '100%',
          height: 400,
          borderRadius: 16,
          overflow: 'hidden',
          background: '#2d6a4f',
        }}
      />

      {/* Overlay interactivo sobre los dados 3D */}
      {visibleItems.map(({ value, fullIndex }) => {
        const isExiting = exitingIndices.includes(fullIndex)
        const canInteract = interactive && !isExiting

        return (
          <div
            key={fullIndex}
            onClick={canInteract ? () => handleKeep(fullIndex) : undefined}
            onTouchStart={canInteract ? (e) => onDieTouchStart(fullIndex, e) : undefined}
            onTouchMove={canInteract ? onDieTouchMove : undefined}
            onTouchEnd={canInteract ? onDieTouchEnd : undefined}
            style={{
              position: 'absolute',
              bottom: isExiting ? '-100px' : '32px',
              left: `calc(${getLeft(fullIndex)} - 36px)`,
              width: 72,
              height: 72,
              borderRadius: 14,
              background: RED_VALUES.has(value)
                ? 'linear-gradient(135deg, #c0392b, #7b1010)'
                : 'linear-gradient(135deg, #1e3a8a, #0c1a4a)',
              border: `3px solid ${RED_VALUES.has(value) ? '#f5c842' : '#94a3c8'}`,
              boxShadow: isExiting ? 'none' : '0 4px 20px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: canInteract ? 'pointer' : 'default',
              userSelect: 'none',
              transition: isExiting
                ? 'bottom 0.3s ease-in, opacity 0.25s ease-in 0.05s'
                : 'bottom 0.3s ease',
              opacity: isExiting ? 0 : 1,
              zIndex: 10,
            }}
          >
            <span style={{
              color: '#fff',
              fontSize: value.length > 1 ? 22 : 28,
              fontWeight: 'bold',
              fontFamily: 'Georgia, serif',
              lineHeight: 1,
            }}>
              {value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
