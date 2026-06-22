import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App'
import './index.css'
import { initAnalytics } from './analytics'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
initAnalytics()

// Lock to portrait on devices that support the Screen Orientation API
if (screen?.orientation?.lock) {
  screen.orientation.lock('portrait').catch(() => {})
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={clientId}>
    <App />
  </GoogleOAuthProvider>
)
