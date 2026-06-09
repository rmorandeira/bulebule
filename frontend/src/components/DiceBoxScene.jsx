import { useEffect, useRef, useCallback, useState } from 'react'
import DiceBox from '@3d-dice/dice-box'

const CONTAINER_ID = 'dice-box-scene'

export default function DiceBoxScene({
  dice = [],
  keptIndices = [],
  interactive = false,
  rolling = false,
  onKeep,
  onSettled,
  onRollStart,
}) {
  const diceBoxRef = useRef(null)
  const readyRef = useRef(false)
  const settledRef = useRef(false)
  const prevDiceKeyRef = useRef(null)
  const pendingRollRef = useRef(null)

  const onSettledRef = useRef(onSettled)
  useEffect(() => { onSettledRef.current = onSettled }, [onSettled])

  const onRollStartRef = useRef(onRollStart)
  useEffect(() => { onRollStartRef.current = onRollStart }, [onRollStart])

  const interactiveRef = useRef(interactive)
  useEffect(() => { interactiveRef.current = interactive }, [interactive])

  const rollingRef = useRef(rolling)
  useEffect(() => { rollingRef.current = rolling }, [rolling])

  const keptIndicesRef = useRef(keptIndices)
  useEffect(() => { keptIndicesRef.current = keptIndices }, [keptIndices])

  const originalItemsRef = useRef([])
  const [visibleItems, setVisibleItems] = useState([])

  const doSettle = useCallback(() => {
    settledRef.current = true
    onSettledRef.current?.()
  }, [])

  const doRoll = useCallback((box, count, items) => {
    settledRef.current = false
    setVisibleItems([])
    onRollStartRef.current?.()
    box.onRollComplete = () => {
      setVisibleItems(items)
      doSettle()
    }
    box.roll(`${count}d6`)
  }, [doSettle])

  // Init
  useEffect(() => {
    const box = new DiceBox({
      container: `#${CONTAINER_ID}`,
      assetPath: '/assets/dice-box/',
      theme: 'smooth',
      themeColor: '#e6e6d7',
      scale: 10,
      gravity: 6,
      mass: 4,
      friction: 0.8,
      restitution: 0.2,
      linearDamping: 0.3,
      angularDamping: 0.3,
      spinForce: 4,
      throwForce: 7,
      startingHeight: 8,
      settleTimeout: 8000,
      delay: 100,
      enableShadows: true,
      shadowTransparency: 0.68,
      lightIntensity: 1.5,
    })

    box.init().then(() => {
      diceBoxRef.current = box
      readyRef.current = true
      if (pendingRollRef.current) {
        const { count, items } = pendingRollRef.current
        pendingRollRef.current = null
        doRoll(box, count, items)
      }
    })

    return () => {
      readyRef.current = false
      diceBoxRef.current = null
    }
  }, [doRoll])

  // Main roll: always show ALL dice on each new roll
  useEffect(() => {
    if (!dice.length) return
    const diceKey = dice.join(',')
    if (diceKey === prevDiceKeyRef.current) return
    prevDiceKeyRef.current = diceKey

    const items = dice.map((_, i) => ({ fullIndex: i }))
    originalItemsRef.current = items

    if (readyRef.current && diceBoxRef.current) {
      doRoll(diceBoxRef.current, items.length, items)
    } else {
      pendingRollRef.current = { count: items.length, items }
    }
  }, [dice, doRoll])

  // Re-render when user keeps/unkeeps a die (skip during active rolls)
  useEffect(() => {
    if (rollingRef.current || !settledRef.current) return
    const box = diceBoxRef.current
    if (!box) return

    const allItems = originalItemsRef.current
    if (!allItems.length) return

    const unkeptItems = allItems.filter(({ fullIndex }) => !keptIndices.includes(fullIndex))

    settledRef.current = false
    setVisibleItems([])
    box.clear()

    if (unkeptItems.length === 0) {
      settledRef.current = true
      return
    }

    box.onRollComplete = () => {
      setVisibleItems(unkeptItems)
      settledRef.current = true
    }
    box.roll(`${unkeptItems.length}d6`)
  }, [keptIndices])

  // Click → map X to die slot
  const handleContainerClick = useCallback((e) => {
    if (!interactiveRef.current || !onKeep) return
    if (!settledRef.current || !visibleItems.length) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const slot = Math.max(0, Math.min(visibleItems.length - 1,
      Math.floor(x / rect.width * visibleItems.length)
    ))
    const { fullIndex } = visibleItems[slot]
    if (keptIndicesRef.current.includes(fullIndex)) return
    onKeep(fullIndex)
  }, [onKeep, visibleItems])

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div
        id={CONTAINER_ID}
        onClick={handleContainerClick}
        style={{
          width: '100%',
          flex: 1,
          background: '#2d6a4f',
          position: 'relative',
          overflow: 'hidden',
          cursor: interactive && visibleItems.length > 0 ? 'pointer' : 'default',
        }}
      />
    </div>
  )
}
