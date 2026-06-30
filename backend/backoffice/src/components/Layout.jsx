import React, { useState } from 'react';

const NAV = [
  { key: 'items',       label: 'Items',        icon: '🎁' },
  { key: 'tournaments', label: 'Campeonatos',   icon: '🏆' },
  { key: 'users',       label: 'Usuarios',      icon: '👥' },
];

export default function Layout({ page, setPage, onLogout }) {
  const [open, setOpen] = useState(false);

  function navigate(key) {
    setPage(key);
    setOpen(false);
  }

  return (
    <div className="app">
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 99 }}
          onClick={() => setOpen(false)}
        />
      )}

      <nav className={`sidebar ${open ? 'open' : ''}`}>
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
              onClick={() => navigate(n.key)}
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
          <button className="hamburger" onClick={() => setOpen(o => !o)}>☰</button>
          <span className="topbar-title">
            {NAV.find(n => n.key === page)?.label ?? 'Backoffice'}
          </span>
        </header>

        <main className="page-content" id="page-content" />
      </div>
    </div>
  );
}
