import { useEffect, useRef } from 'react'

const DEV = import.meta.env.DEV

export default function AdBanner({ slot = '3181703270' }) {
  const ref = useRef(null)
  const pushed = useRef(false)

  useEffect(() => {
    if (DEV) return
    if (pushed.current) return
    pushed.current = true
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch (e) {
      // AdSense not loaded (adblocker)
    }
  }, [])

  if (DEV) {
    return (
      <div style={{ width: '100%', height: '100%', minHeight: 40, background: '#ff0000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 12 }}>AD</span>
      </div>
    )
  }

  return (
    <div className="ad-banner" ref={ref}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block', height: '50px' }}
        data-ad-client="ca-pub-4894674675461010"
        data-ad-slot={slot}
        data-ad-format="horizontal"
        data-full-width-responsive="false"
      />
    </div>
  )
}
