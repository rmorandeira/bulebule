import React, { useState } from 'react';

export default function Login({ onLogin }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/items', {
        headers: { Authorization: `Bearer ${token.trim()}` },
      });
      if (res.status === 401) { setError('Token incorrecto'); return; }
      if (!res.ok) { setError(`Error del servidor (${res.status})`); return; }
      onLogin(token.trim());
    } catch {
      setError('No se pudo conectar con el servidor');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1><span>🎲</span> Backoffice</h1>
        <p className="sub">Acceso al panel de administración de Bule Bule</p>

        <form onSubmit={handleSubmit}>
          {error && <div className="error-msg">{error}</div>}

          <div className="form-group">
            <label htmlFor="token">Token de acceso</label>
            <input
              id="token"
              type="password"
              placeholder="Token del log de Railway…"
              value={token}
              onChange={e => setToken(e.target.value)}
              autoFocus
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            disabled={loading || !token.trim()}
          >
            {loading ? 'Verificando…' : 'Acceder'}
          </button>
        </form>

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          El token aparece en los logs de Railway al arrancar el servidor por primera vez.
        </p>
      </div>
    </div>
  );
}
