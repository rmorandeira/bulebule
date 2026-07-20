import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import Switch from '../components/Switch.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Settings() {
  const toast = useToast();
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [maxPlayersLimit, setMaxPlayersLimit] = useState(8);
  const [minVersionCode, setMinVersionCode] = useState(0);
  const [flags, setFlags]               = useState({});
  const [newFlagKey, setNewFlagKey]     = useState('');
  const [versions, setVersions]         = useState([]);
  const [newVersionCode, setNewVersionCode] = useState('');
  const [newVersionName, setNewVersionName] = useState('');
  const [addingVersion, setAddingVersion]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ settings }, { versions: appVersions }] = await Promise.all([
        api.settings.get(),
        api.appVersions.list(),
      ]);
      setMaxPlayersLimit(settings.maxPlayersLimit ?? 8);
      setMinVersionCode(settings.minVersionCode ?? 0);
      setFlags(settings.featureFlags ?? {});
      setVersions(appVersions ?? []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function addVersion() {
    const code = parseInt(newVersionCode);
    const name = newVersionName.trim();
    if (!Number.isFinite(code) || code <= 0) return toast('versionCode debe ser un entero positivo', 'error');
    if (!name) return toast('Falta el versionName', 'error');
    if (versions.some(v => v.versionCode === code)) return toast('Ya existe esa versión', 'error');
    setAddingVersion(true);
    try {
      await api.appVersions.create({ versionCode: code, versionName: name });
      setVersions(v => [...v, { versionCode: code, versionName: name }].sort((a, b) => b.versionCode - a.versionCode));
      setNewVersionCode('');
      setNewVersionName('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setAddingVersion(false);
    }
  }

  async function removeVersion(versionCode) {
    try {
      await api.appVersions.delete(versionCode);
      setVersions(v => v.filter(x => x.versionCode !== versionCode));
      if (minVersionCode === versionCode) setMinVersionCode(0);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

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
              {versions.map(v => (
                <option key={v.versionCode} value={v.versionCode}>
                  {v.versionName} (versionCode {v.versionCode})
                </option>
              ))}
              {minVersionCode > 0 && !versions.some(v => v.versionCode === minVersionCode) && (
                <option value={minVersionCode}>versionCode {minVersionCode} (no listada)</option>
              )}
            </select>
            <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 6 }}>
              Los usuarios con una versión de la app anterior a la seleccionada verán una pantalla
              bloqueante pidiéndoles actualizar desde Play Store. "Sin restricción" la desactiva.
            </p>
          </div>

          <div className="form-group">
            <label>Versiones publicadas</label>
            {versions.length === 0 ? (
              <div className="empty-state">
                <p>No hay versiones registradas todavía</p>
              </div>
            ) : (
              versions.map(v => (
                <div key={v.versionCode} className="toggle-row" style={{ justifyContent: 'space-between' }}>
                  <label style={{ flex: 1 }}>{v.versionName} <span style={{ opacity: 0.6 }}>(versionCode {v.versionCode})</span></label>
                  <button className="btn btn-ghost btn-icon" onClick={() => removeVersion(v.versionCode)} aria-label={`Eliminar ${v.versionName}`}>✕</button>
                </div>
              ))
            )}
            <div className="form-row" style={{ marginTop: 14, gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: 11, opacity: 0.7 }}>versionCode (entero, de build.gradle)</label>
                <input
                  type="number"
                  placeholder="ej: 56"
                  value={newVersionCode}
                  onChange={e => setNewVersionCode(e.target.value)}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, opacity: 0.7 }}>versionName (texto, de build.gradle)</label>
                <input
                  placeholder="ej: 1.3.31"
                  value={newVersionName}
                  onChange={e => setNewVersionName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addVersion(); }}
                />
              </div>
              <button className="btn btn-secondary" onClick={addVersion} disabled={addingVersion}>+ Registrar</button>
            </div>
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
