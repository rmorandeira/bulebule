export function initTheme() {
  const pref = localStorage.getItem('bule_theme') || 'system'
  document.documentElement.setAttribute('data-theme', pref)
}

export function setTheme(pref) {
  localStorage.setItem('bule_theme', pref)
  document.documentElement.setAttribute('data-theme', pref)
}

export function getTheme() {
  return localStorage.getItem('bule_theme') || 'system'
}
