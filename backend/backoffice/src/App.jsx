import React, { useState, useEffect } from 'react';
import { ToastProvider } from './components/Toast.jsx';
import Login from './pages/Login.jsx';
import Items from './pages/Items.jsx';
import Tournaments from './pages/Tournaments.jsx';
import Users from './pages/Users.jsx';
import Settings from './pages/Settings.jsx';
import Feedback from './pages/Feedback.jsx';

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('bo_theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('bo_theme', theme);
  }, [theme]);
  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark');
  return [theme, toggle];
}

const NAV_LABELS = {
  items:       '🎁 Items',
  tournaments: '🏆 Campeonatos',
  users:       '👥 Usuarios',
  feedback:    '💬 Quejas y sugerencias',
  settings:    '⚙️ Ajustes',
};

const NAV = [
  { key: 'items',       label: 'Items',        icon: '🎁' },
  { key: 'tournaments', label: 'Campeonatos',   icon: '🏆' },
  { key: 'users',       label: 'Usuarios',      icon: '👥' },
  { key: 'feedback',    label: 'Quejas/sug.',   icon: '💬' },
  { key: 'settings',    label: 'Ajustes',       icon: '⚙️' },
];

const PAGES = { items: Items, tournaments: Tournaments, users: Users, feedback: Feedback, settings: Settings };

function AppShell({ token, onLogout }) {
  const [page, setPage] = useState('items');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();

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
          <button className="theme-toggle" onClick={toggleTheme} title="Cambiar tema">
            {theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro'}
          </button>
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
