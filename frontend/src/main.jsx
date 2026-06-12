import React from 'react'
import ReactDOM from 'react-dom/client'
import { GoogleOAuthProvider } from '@react-oauth/google'
import App from './App'
import './index.css'
import { initAnalytics } from './analytics'

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
initAnalytics()

ReactDOM.createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={clientId}>
    <App />
  </GoogleOAuthProvider>
)
