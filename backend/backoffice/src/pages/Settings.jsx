import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import Switch from '../components/Switch.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Settings() {
  const toast = useToast();
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [maxPlayersLimit, setMaxPlayersLimit] = useState(8);
  const [flags, setFlags]               = useState({});
  const [newFlagKey, setNewFlagKey]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { settings } = await api.settings.get();
      setMaxPlayersLimit(settings.maxPlayersLimit ?? 8);
      setFlags(settings.featureFlags ?? {});
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  function toggleFlag(key) {
    setFlags(f => ({ ...f, [key]: !f[key] }));
  }

  function removeFlag(key) {
    setFlags(f => {
      const next = { ...f };
      delete next[key];
      return next;
    });
  }

  function addFlag() {
    const key = newFlagKey.trim();
    if (!key) return;
    if (key in flags) return toast('Ya existe un flag con ese nombre', 'error');
    setFlags(f => ({ ...f, [key]: false }));
    setNewFlagKey('');
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.settings.update({ maxPlayersLimit: Number(maxPlayersLimit), featureFlags: flags });
      toast('Ajustes guardados', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading">Cargando…</div>;

  const flagEntries = Object.entries(flags);

  return (
    <div>
      <div className="page-header">
        <h1>⚙️ Ajustes</h1>
      </div>

      <div style={{ maxWidth: 560 }}>
        <div className="panel-section">
          <h3>Parámetros</h3>
          <div className="form-group">
            <label>Jugadores máximos por partida</label>
            <input
              type="number"
              min="2"
              max="10"
              value={maxPlayersLimit}
              onChange={e => setMaxPlayersLimit(e.target.value)}
            />
          </div>
        </div>

        <div className="panel-section">
          <h3>Feature flags</h3>
          {flagEntries.length === 0 ? (
            <div className="empty-state">
              <p>No hay feature flags todavía</p>
            </div>
          ) : (
            flagEntries.map(([key, value]) => (
              <div key={key} className="toggle-row" style={{ justifyContent: 'space-between' }}>
                <label style={{ flex: 1 }}>{key}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Switch checked={!!value} onChange={() => toggleFlag(key)} />
                  <button className="btn btn-ghost btn-icon" onClick={() => removeFlag(key)} aria-label={`Eliminar ${key}`}>✕</button>
                </div>
              </div>
            ))
          )}

          <div className="form-row" style={{ marginTop: 14, gridTemplateColumns: '1fr auto' }}>
            <input
              placeholder="nombre-del-flag"
              value={newFlagKey}
              onChange={e => setNewFlagKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addFlag(); }}
            />
            <button className="btn btn-secondary" onClick={addFlag}>+ Añadir flag</button>
          </div>
        </div>

        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
