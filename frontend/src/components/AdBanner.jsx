import { useEffect, useRef } from 'react'

export default function AdBanner() {
  const ref = useRef(null)
  const pushed = useRef(false)

  useEffect(() => {
    if (pushed.current) return
    pushed.current = true
    try {
      ;(window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch (e) {
      // AdSense not loaded (dev, adblocker)
    }
  }, [])

  return (
    <div className="ad-banner" ref={ref}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-4894674675461010"
        data-ad-slot="3181703270"
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
