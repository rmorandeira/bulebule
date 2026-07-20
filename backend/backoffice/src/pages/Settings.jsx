import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import Switch from '../components/Switch.jsx';
import { useToast } from '../components/Toast.jsx';
import { APP_VERSIONS } from '../appVersions.js';

export default function Settings() {
  const toast = useToast();
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [maxPlayersLimit, setMaxPlayersLimit] = useState(8);
  const [minVersionCode, setMinVersionCode] = useState(0);
  const [flags, setFlags]               = useState({});
  const [newFlagKey, setNewFlagKey]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { settings } = await api.settings.get();
      setMaxPlayersLimit(settings.maxPlayersLimit ?? 8);
      setMinVersionCode(settings.minVersionCode ?? 0);
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
      await api.settings.update({ maxPlayersLimit: Number(maxPlayersLimit), featureFlags: flags, minVersionCode: Number(minVersionCode) });
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
          <h3>Actualización forzosa</h3>
          <div className="form-group">
            <label>Versión mínima de la aplicación</label>
            <select
              value={minVersionCode}
              onChange={e => setMinVersionCode(Number(e.target.value))}
            >
              <option value={0}>Sin restricción</option>
              {APP_VERSIONS.map(v => (
                <option key={v.versionCode} value={v.versionCode}>
                  {v.versionName} (versionCode {v.versionCode})
                </option>
              ))}
              {minVersionCode > 0 && !APP_VERSIONS.some(v => v.versionCode === minVersionCode) && (
                <option value={minVersionCode}>versionCode {minVersionCode} (no listada)</option>
              )}
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 6 }}>
              Los usuarios con una versión de la app anterior a la seleccionada verán una pantalla
              bloqueante pidiéndoles actualizar desde Play Store. "Sin restricción" la desactiva.
            </p>
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
