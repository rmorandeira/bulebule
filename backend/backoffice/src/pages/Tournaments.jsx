import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { imgSrc } from '../config.js';
import Modal from '../components/Modal.jsx';
import Confirm from '../components/Confirm.jsx';
import { useToast } from '../components/Toast.jsx';

const TIERS      = ['Bronce', 'Plata', 'Oro', 'Diamante', 'Especial', 'Abierto'];
const TYPES      = ['tier', 'special', 'open'];
const TYPE_LABELS = { tier: 'Por tier', special: 'Especial', open: 'Abierto' };

const TIER_BADGE = {
  Bronce:   'badge-yellow',
  Plata:    'badge-gray',
  Oro:      'badge-yellow',
  Diamante: 'badge-blue',
  Especial: 'badge-purple',
  Abierto:  'badge-green',
};

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function tsToDatetimeLocal(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toISOString().slice(0, 16);
}

function datetimeLocalToTs(str) {
  if (!str) return null;
  return Math.floor(new Date(str).getTime() / 1000);
}

function slugify(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const EMPTY_FORM = {
  id: '', name: '', description: '', tier: 'Bronce', type: 'tier',
  min_score: 0, max_score: -1, required_item: '',
  rules: '', starts_at: '', ends_at: '', active: true, sort_order: 0,
};

function TournamentPanel({ t, items, onEdit, onDelete, onClose }) {
  const reqItem = t.required_item ? items.find(i => i.id === t.required_item) : null;

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="panel">
        <div className="panel-header">
          <h2>Detalle campeonato</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="panel-body">
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>ID: {t.id}</div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            <span className={`badge ${TIER_BADGE[t.tier] ?? 'badge-gray'}`}>{t.tier}</span>
            <span className="badge badge-gray">{TYPE_LABELS[t.type] ?? t.type}</span>
            <span className={`badge ${t.active ? 'badge-green' : 'badge-red'}`}>
              {t.active ? 'Activo' : 'Inactivo'}
            </span>
          </div>

          {t.description && (
            <div className="panel-section">
              <h3>Descripción</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>{t.description}</p>
            </div>
          )}

          <div className="panel-section">
            <h3>Datos</h3>
            <table style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                <tr>
                  <td style={{ color: 'var(--text-muted)', paddingBottom: 6, width: '45%' }}>Puntos</td>
                  <td style={{ fontWeight: 600 }}>
                    {t.min_score.toLocaleString()} – {t.max_score === -1 ? '∞' : t.max_score.toLocaleString()}
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-muted)', paddingBottom: 6 }}>Período</td>
                  <td>{fmtDate(t.starts_at)} – {fmtDate(t.ends_at)}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-muted)', paddingBottom: 6 }}>Orden</td>
                  <td>{t.sort_order ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {reqItem && (
            <div className="panel-section">
              <h3>Item requerido</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)', borderRadius: 6, padding: '10px 12px' }}>
                {reqItem.image_url && (
                  <img src={imgSrc(reqItem.image_url)} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
                )}
                <div>
                  <div style={{ fontWeight: 600 }}>{reqItem.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{reqItem.id}</div>
                </div>
              </div>
            </div>
          )}

          {t.rules && (
            <div className="panel-section">
              <h3>Reglas</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{t.rules}</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onEdit}>✎ Editar</button>
            <button className="btn btn-danger" onClick={onDelete}>Eliminar</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Tournaments() {
  const toast = useToast();
  const [allItems, setAllItems] = useState([]);
  const [list, setList]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [confirm, setConfirm]   = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ tournaments }, { items }] = await Promise.all([api.tournaments.list(), api.items.list()]);
      setList(tournaments);
      setAllItems(items);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditModal('create');
  }

  function openEdit(t) {
    setForm({
      id:            t.id,
      name:          t.name,
      description:   t.description ?? '',
      tier:          t.tier,
      type:          t.type,
      min_score:     t.min_score,
      max_score:     t.max_score,
      required_item: t.required_item ?? '',
      rules:         t.rules ?? '',
      starts_at:     tsToDatetimeLocal(t.starts_at),
      ends_at:       tsToDatetimeLocal(t.ends_at),
      active:        t.active === 1,
      sort_order:    t.sort_order ?? 0,
    });
    setEditModal(t);
  }

  function field(key) {
    return e => {
      const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setForm(f => {
        const next = { ...f, [key]: val };
        if (key === 'name' && editModal === 'create') next.id = slugify(val);
        return next;
      });
    };
  }

  async function handleSave() {
    setSaving(true);
    const payload = {
      ...form,
      min_score:     Number(form.min_score),
      max_score:     Number(form.max_score),
      sort_order:    Number(form.sort_order),
      starts_at:     datetimeLocalToTs(form.starts_at),
      ends_at:       datetimeLocalToTs(form.ends_at),
      required_item: form.required_item || null,
      description:   form.description || null,
      rules:         form.rules || null,
    };
    try {
      if (editModal === 'create') {
        await api.tournaments.create(payload);
        toast('Campeonato creado', 'success');
      } else {
        await api.tournaments.update(editModal.id, payload);
        toast('Campeonato actualizado', 'success');
        setSelected(prev => prev?.id === editModal.id ? { ...prev, ...payload } : prev);
      }
      setEditModal(null);
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t) {
    try {
      await api.tournaments.delete(t.id);
      toast('Campeonato eliminado', 'success');
      setConfirm(null);
      setSelected(null);
      load();
    } catch (e) {
      toast(e.message, 'error');
      setConfirm(null);
    }
  }

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="page-header">
          <h1>🏆 Campeonatos</h1>
          <button className="btn btn-primary" onClick={openCreate}>+ Nuevo campeonato</button>
        </div>

        {loading ? (
          <div className="loading">Cargando…</div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏆</div>
            <p>No hay campeonatos todavía</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Tier / Tipo</th>
                  <th>Puntos</th>
                  <th>Período</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {list.map(t => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(t)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.id}</div>
                    </td>
                    <td>
                      <span className={`badge ${TIER_BADGE[t.tier] ?? 'badge-gray'}`}>{t.tier}</span>
                      {' '}
                      <span className="badge badge-gray">{TYPE_LABELS[t.type] ?? t.type}</span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {t.min_score.toLocaleString()} – {t.max_score === -1 ? '∞' : t.max_score.toLocaleString()}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t.starts_at || t.ends_at ? `${fmtDate(t.starts_at)} – ${fmtDate(t.ends_at)}` : '—'}
                    </td>
                    <td>
                      <span className={`badge ${t.active ? 'badge-green' : 'badge-red'}`}>
                        {t.active ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <TournamentPanel
          t={selected}
          items={allItems}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => setConfirm(selected)}
        />
      )}

      {editModal && (
        <Modal
          title={editModal === 'create' ? 'Nuevo campeonato' : `Editar: ${editModal.name}`}
          onClose={() => setEditModal(null)}
          onSubmit={handleSave}
          submitting={saving}
          wide
        >
          <div className="form-row">
            <div className="form-group">
              <label>Nombre *</label>
              <input value={form.name} onChange={field('name')} required placeholder="Torneo Verano 2025" />
            </div>
            <div className="form-group">
              <label>ID *</label>
              <input
                value={form.id}
                onChange={field('id')}
                required
                placeholder="torneo-verano-2025"
                disabled={editModal !== 'create'}
                style={editModal !== 'create' ? { opacity: 0.5 } : undefined}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Descripción</label>
            <textarea value={form.description} onChange={field('description')} placeholder="Descripción del campeonato…" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Tier</label>
              <select value={form.tier} onChange={field('tier')}>
                {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Tipo</label>
              <select value={form.type} onChange={field('type')}>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Puntos mínimos</label>
              <input type="number" min="0" value={form.min_score} onChange={field('min_score')} />
            </div>
            <div className="form-group">
              <label>Puntos máximos (-1 = sin límite)</label>
              <input type="number" min="-1" value={form.max_score} onChange={field('max_score')} />
            </div>
          </div>

          <div className="form-group">
            <label>Item requerido</label>
            <select value={form.required_item} onChange={field('required_item')}>
              <option value="">— Sin requisito de item —</option>
              {allItems.map(i => <option key={i.id} value={i.id}>{i.name} ({i.id})</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Reglas</label>
            <textarea value={form.rules} onChange={field('rules')} rows={4} placeholder="Describe las reglas del campeonato…" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Inicio</label>
              <input type="datetime-local" value={form.starts_at} onChange={field('starts_at')} />
            </div>
            <div className="form-group">
              <label>Fin</label>
              <input type="datetime-local" value={form.ends_at} onChange={field('ends_at')} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Orden</label>
              <input type="number" min="0" value={form.sort_order} onChange={field('sort_order')} />
            </div>
          </div>

          <div className="toggle-row">
            <input type="checkbox" id="active" checked={form.active} onChange={field('active')} />
            <label htmlFor="active">Campeonato activo (visible para jugadores)</label>
          </div>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="¿Eliminar campeonato?"
          message={`Se eliminará "${confirm.name}" de forma permanente. Los jugadores activos perderán su conexión al campeonato.`}
          onConfirm={() => handleDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
