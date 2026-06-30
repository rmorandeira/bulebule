import React, { useState, useEffect } from 'react';
import { ToastProvider } from './components/Toast.jsx';
import Login from './pages/Login.jsx';
import Items from './pages/Items.jsx';
import Tournaments from './pages/Tournaments.jsx';
import Users from './pages/Users.jsx';

const NAV_LABELS = {
  items:       '🎁 Items',
  tournaments: '🏆 Campeonatos',
  users:       '👥 Usuarios',
};

const NAV = [
  { key: 'items',       label: 'Items',        icon: '🎁' },
  { key: 'tournaments', label: 'Campeonatos',   icon: '🏆' },
  { key: 'users',       label: 'Usuarios',      icon: '👥' },
];

const PAGES = { items: Items, tournaments: Tournaments, users: Users };

function AppShell({ token, onLogout }) {
  const [page, setPage] = useState('items');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const Page = PAGES[page];

  return (
    <div className="app">
      {sidebarOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'transparent' }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <nav className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <span className="emoji">🎲</span>
          <span>Bule Bule</span>
        </div>

        <div className="sidebar-nav">
          <div className="nav-label">Gestión</div>
          {NAV.map(n => (
            <button
              key={n.key}
              className={`nav-item ${page === n.key ? 'active' : ''}`}
              onClick={() => { setPage(n.key); setSidebarOpen(false); }}
            >
              <span className="icon">{n.icon}</span>
              {n.label}
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <button className="nav-item" onClick={onLogout}>
            <span className="icon">🚪</span>
            Cerrar sesión
          </button>
        </div>
      </nav>

      <div className="main-wrap">
        <header className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>☰</button>
          <span className="topbar-title">{NAV_LABELS[page]}</span>
        </header>

        <main className="page-content">
          <Page />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('admin_token') || '');

  function handleLogin(t) {
    localStorage.setItem('admin_token', t);
    setToken(t);
  }

  function handleLogout() {
    localStorage.removeItem('admin_token');
    setToken('');
  }

  if (!token) return (
    <ToastProvider>
      <Login onLogin={handleLogin} />
    </ToastProvider>
  );

  return (
    <ToastProvider>
      <AppShell token={token} onLogout={handleLogout} />
    </ToastProvider>
  );
}
