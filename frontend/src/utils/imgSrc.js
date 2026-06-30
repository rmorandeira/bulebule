const BACKEND = import.meta.env.VITE_BACKEND_URL || ''

export function imgSrc(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  if (url.startsWith('/uploads/')) return `${BACKEND}${url}`
  return url // /assets/... served by Firebase (same origin)
}
