import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

// En nativo, un <a target="_blank"> normal navega el propio WebView de la
// app (no abre una ventana real) — al volver atrás, el WebView recarga
// index.html desde cero y el usuario aparece en la intro, con todo el
// estado de React perdido. Browser.open() abre una pestaña de sistema
// (Chrome Custom Tabs) por encima, sin tocar el WebView de la app.
export async function openExternal(path) {
  if (Capacitor.isNativePlatform()) {
    const url = path.startsWith('http') ? path : `${window.location.origin}${path}`
    await Browser.open({ url })
  } else {
    window.open(path, '_blank', 'noopener,noreferrer')
  }
}
