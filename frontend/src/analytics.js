const UMAMI_URL = import.meta.env.VITE_UMAMI_URL
const WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID

export function initAnalytics() {
  if (!UMAMI_URL || !WEBSITE_ID) return
  const s = document.createElement('script')
  s.defer = true
  s.src = `${UMAMI_URL}/script.js`
  s.setAttribute('data-website-id', WEBSITE_ID)
  document.head.appendChild(s)
}

export function track(event, data = {}) {
  window.umami?.track(event, data)
}
