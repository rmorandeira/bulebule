import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import Modal from '../components/Modal.jsx';
import Confirm from '../components/Confirm.jsx';
import Switch from '../components/Switch.jsx';
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
  rules: '', starts_at: '', ends_at: '', active: true, visible: true, sort_order: 0,
};

export default function Tournaments() {
  const toast = useToast();
  const [allItems, setAllItems] = useState([]);
  const [list, setList]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [editModal, setEditModal] = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [confirm, setConfirm]   = useState(null);
  const [filterTier, setFilterTier]     = useState('');
  const [filterVisible, setFilterVisible] = useState('');
  const [filterActive, setFilterActive] = useState('');

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
      visible:       t.visible === 1,
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

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
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
      setEditModal(null);
      load();
    } catch (e) {
      toast(e.message, 'error');
      setConfirm(null);
    }
  }

  const filtered = list.filter(t => {
    if (filterTier    && t.tier !== filterTier) return false;
    if (filterVisible === 'visible' && !t.visible) return false;
    if (filterVisible === 'hidden'  &&  t.visible) return false;
    if (filterActive  === 'active'   && !t.active) return false;
    if (filterActive  === 'inactive' &&  t.active) return false;
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <h1>🏆 Campeonatos</h1>
        <button className="btn btn-primary" onClick={openCreate}>+ Nuevo campeonato</button>
      </div>

      <div className="filter-bar">
        <button className={`filter-chip ${filterTier === '' ? 'active' : ''}`} onClick={() => setFilterTier('')}>Todos</button>
        {TIERS.map(t => (
          <button key={t} className={`filter-chip ${filterTier === t ? 'active' : ''}`} onClick={() => setFilterTier(filterTier === t ? '' : t)}>{t}</button>
        ))}
        <div className="filter-sep" />
        <button className={`filter-chip ${filterVisible === '' ? 'active' : ''}`} onClick={() => setFilterVisible('')}>Todos</button>
        <button className={`filter-chip ${filterVisible === 'visible' ? 'active' : ''}`} onClick={() => setFilterVisible(filterVisible === 'visible' ? '' : 'visible')}>Visibles</button>
        <button className={`filter-chip ${filterVisible === 'hidden' ? 'active' : ''}`} onClick={() => setFilterVisible(filterVisible === 'hidden' ? '' : 'hidden')}>Ocultos</button>
        <div className="filter-sep" />
        <button className={`filter-chip ${filterActive === '' ? 'active' : ''}`} onClick={() => setFilterActive('')}>Todos</button>
        <button className={`filter-chip ${filterActive === 'active' ? 'active' : ''}`} onClick={() => setFilterActive(filterActive === 'active' ? '' : 'active')}>Activos</button>
        <button className={`filter-chip ${filterActive === 'inactive' ? 'active' : ''}`} onClick={() => setFilterActive(filterActive === 'inactive' ? '' : 'inactive')}>Inactivos</button>
      </div>

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🏆</div>
          <p>No hay campeonatos{filterTier || filterActive ? ' con estos filtros' : ' todavía'}</p>
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
              {filtered.map(t => (
                <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(t)}>
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
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className={`badge ${t.visible ? 'badge-green' : 'badge-gray'}`}>{t.visible ? 'Visible' : 'Oculto'}</span>
                      <span className={`badge ${t.active ? 'badge-green' : 'badge-red'}`}>{t.active ? 'Activo' : 'Inactivo'}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editModal && (
        <Modal
          title={editModal === 'create' ? 'Nuevo campeonato' : `Editar: ${editModal.name}`}
          onClose={() => setEditModal(null)}
          onSubmit={handleSave}
          submitting={saving}
          onDelete={editModal !== 'create' ? () => setConfirm(editModal) : undefined}
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
            <Switch checked={form.visible} onChange={v => setField('visible', v)} />
            <label>Visible para jugadores</label>
          </div>
          <div className="toggle-row">
            <Switch checked={form.active} onChange={v => setField('active', v)} disabled={!form.visible} />
            <label style={!form.visible ? { opacity: 0.5 } : undefined}>Activo (inscribible)</label>
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
