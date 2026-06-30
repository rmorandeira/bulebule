import { useRef, useCallback } from 'react'

const DISMISS_THRESHOLD = 80  // px dragged down to trigger dismiss
const SAFETY_TOP = 90         // px from screen top the handle cannot cross

export function useSheetDrag(onClose) {
  const sheetRef    = useRef(null)
  const startY      = useRef(0)
  const startTop    = useRef(0)
  const dragY       = useRef(0)

  const applyTranslate = (y, animated = false) => {
    const el = sheetRef.current
    if (!el) return
    el.style.transition = animated ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
    el.style.transform  = y === 0 ? '' : `translateY(${y}px)`
  }

  const onPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    startY.current   = e.clientY
    startTop.current = sheetRef.current?.getBoundingClientRect().top ?? 0
    dragY.current    = 0
  }, [])

  const onPointerMove = useCallback((e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const delta = e.clientY - startY.current
    // Clamp upward drag: handle can't go above SAFETY_TOP px from screen top
    const minDelta = SAFETY_TOP - startTop.current
    const clamped  = Math.max(minDelta, delta)
    dragY.current  = clamped
    applyTranslate(clamped)
  }, [])

  const onPointerUp = useCallback((e) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (dragY.current > DISMISS_THRESHOLD) {
      // Reset inline styles so the CSS closing animation plays cleanly
      const el = sheetRef.current
      if (el) { el.style.transform = ''; el.style.transition = '' }
      onClose()
    } else {
      applyTranslate(0, true)
    }
    dragY.current = 0
  }, [onClose])

  return {
    sheetRef,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      style: { touchAction: 'none', cursor: 'grab' },
    },
  }
}
