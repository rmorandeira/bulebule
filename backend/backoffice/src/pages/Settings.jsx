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
  const [forceLatestVersion, setForceLatestVersion] = useState(false);
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
      setForceLatestVersion(settings.forceLatestVersion ?? false);
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
      const next = [...versions, { versionCode: code, versionName: name }].sort((a, b) => b.versionCode - a.versionCode);
      setVersions(next);
      if (forceLatestVersion) setMinVersionCode(next[0]?.versionCode ?? 0);
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
      const next = versions.filter(x => x.versionCode !== versionCode);
      setVersions(next);
      if (forceLatestVersion) setMinVersionCode(next[0]?.versionCode ?? 0);
      else if (minVersionCode === versionCode) setMinVersionCode(0);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function toggleFlag(key) {
    setFlags(f => ({ ...f, [key]: !f[key] }));
  }

  // Un flag ausente cuenta como activado (comportamiento por defecto antes
  // de que existiera esta pantalla) — igual que en el servidor.
  function flagOn(key) {
    return flags[key] !== false;
  }
  function setFlag(key, value) {
    setFlags(f => ({ ...f, [key]: value }));
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
      const { settings } = await api.settings.update({
        maxPlayersLimit: Number(maxPlayersLimit),
        featureFlags: flags,
        minVersionCode: Number(minVersionCode),
        forceLatestVersion,
      });
      setMinVersionCode(settings.minVersionCode ?? 0);
      toast('Ajustes guardados', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading">Cargando…</div>;

  const RESERVED_FLAGS = ['storyMode', 'comments', 'emojis', 'marketplace', 'tournaments'];
  const flagEntries = Object.entries(flags).filter(([key]) => !RESERVED_FLAGS.includes(key));

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
            <label className="radio-row">
              <input
                type="radio"
                name="version-mode"
                checked={forceLatestVersion}
                onChange={() => {
                  setForceLatestVersion(true);
                  setMinVersionCode(versions[0]?.versionCode ?? 0);
                }}
              />
              <span>
                <span className="radio-row__title">Forzar a última versión publicada</span>
                <span className="radio-row__hint" style={{ display: 'block' }}>
                  {versions[0]
                    ? `Se mantendrá siempre sincronizado con la versión más reciente registrada abajo (actualmente ${versions[0].versionName}, versionCode ${versions[0].versionCode}). No hace falta volver aquí después de registrar una nueva versión.`
                    : 'Aún no hay versiones registradas — no se forzará nada hasta que registres al menos una.'}
                </span>
              </span>
            </label>

            <label className="radio-row" style={{ marginBottom: forceLatestVersion ? 0 : undefined }}>
              <input
                type="radio"
                name="version-mode"
                checked={!forceLatestVersion}
                onChange={() => setForceLatestVersion(false)}
              />
              <span>
                <span className="radio-row__title">Seleccionar versión</span>
                <span className="radio-row__hint" style={{ display: 'block' }}>
                  Elige manualmente la versión mínima. Se queda fija hasta que la cambies tú.
                </span>
              </span>
            </label>

            {!forceLatestVersion && (
              <div style={{ marginTop: 10 }}>
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
              </div>
            )}

            <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 10 }}>
              Los usuarios con una versión de la app anterior a la mínima verán una pantalla
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
          <h3>Modo Historia y comunicación</h3>

          <div className="toggle-row" style={{ justifyContent: 'space-between' }}>
            <label style={{ flex: 1 }}>Modo Historia</label>
            <Switch checked={flagOn('storyMode')} onChange={() => setFlag('storyMode', !flagOn('storyMode'))} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 4 }}>
            Si se desactiva, los jugadores no podrán entrar al mapa ni combatir en Modo Historia (tanto en la app como si fuerzan la petición).
          </p>

          <div className="toggle-row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <label style={{ flex: 1 }}>Comentarios (mensajes de texto en sala)</label>
            <Switch checked={flagOn('comments')} onChange={() => setFlag('comments', !flagOn('comments'))} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 4 }}>
            Mensajes de texto libre que los jugadores se envían mientras esperan su turno.
          </p>
          {!flagOn('comments') && (
            <p style={{ fontSize: 12, color: 'var(--warning)', marginTop: 6 }}>
              ⚠️ Al desactivar los comentarios también se desactiva la opción de "denunciar mal comportamiento"
              en el perfil de usuario, ya que depende de poder describir el mensaje a reportar.
            </p>
          )}

          <div className="toggle-row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <label style={{ flex: 1 }}>Emoticonos (reacciones rápidas en sala)</label>
            <Switch checked={flagOn('emojis')} onChange={() => setFlag('emojis', !flagOn('emojis'))} />
          </div>

          <div className="toggle-row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <label style={{ flex: 1 }}>Marketplace (tienda)</label>
            <Switch checked={flagOn('marketplace')} onChange={() => setFlag('marketplace', !flagOn('marketplace'))} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 4 }}>
            Si se desactiva, se oculta la pestaña Tienda y también la sección de items comprados en el perfil de usuario.
          </p>

          <div className="toggle-row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
            <label style={{ flex: 1 }}>Campeonatos</label>
            <Switch checked={flagOn('tournaments')} onChange={() => setFlag('tournaments', !flagOn('tournaments'))} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted, #888)', marginTop: 4 }}>
            Si se desactiva, se oculta la pestaña Campeonatos y no se puede entrar ni crear salas de torneo.
          </p>
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
