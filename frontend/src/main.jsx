import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { Capacitor } from '@capacitor/core'
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth'
import App from './App'
import './index.css'
import { initAnalytics } from './analytics'
import { initTheme } from './theme'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
initTheme()
initAnalytics()

if (Capacitor.isNativePlatform()) {
  GoogleAuth.initialize({
    clientId,
    scopes: ['profile', 'email'],
    grantOfflineAccess: false,
  })
}

// Lock to portrait on devices that support the Screen Orientation API
if (screen?.orientation?.lock) {
  screen.orientation.lock('portrait').catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={clientId}>
    <App />
  </GoogleOAuthProvider>
)
