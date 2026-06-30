export const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL || 'https://bulebule.web.app';

export function imgSrc(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  return `${FRONTEND_URL}${url}`;
}
