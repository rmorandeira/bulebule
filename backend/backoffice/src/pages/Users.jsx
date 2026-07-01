import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import Confirm from '../components/Confirm.jsx';
import Modal from '../components/Modal.jsx';
import Switch from '../components/Switch.jsx';
import { useToast } from '../components/Toast.jsx';

const TIERS = [
  { name: 'Diamante', min: 700,  color: 'badge-blue'   },
  { name: 'Oro',      min: 300,  color: 'badge-yellow' },
  { name: 'Plata',    min: 100,  color: 'badge-gray'   },
  { name: 'Bronce',   min: 0,    color: 'badge-yellow' },
];
function getTier(score) { return TIERS.find(t => (score ?? 0) >= t.min) ?? TIERS[TIERS.length - 1]; }
function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function Users() {
  const toast = useToast();
  const [users, setUsers]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [offset, setOffset]         = useState(0);
  const [editModal, setEditModal]   = useState(null);
  const [editForm, setEditForm]     = useState({ name: '', email: '', score: 0, active: true, visible: true });
  const [detail, setDetail]         = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [confirm, setConfirm]       = useState(null);
  const [filterTier, setFilterTier] = useState('');
  const [filterVisible, setFilterVisible] = useState('');
  const [filterActive, setFilterActive]   = useState('');

  // ── Multi-select ────────────────────────────────────────────
  const [selected, setSelected]       = useState(new Set());
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const LIMIT = 50;
  const searchRef = useRef(null);

  const visibleUsers = users.filter(u => {
    if (filterTier && getTier(u.score).name !== filterTier) return false;
    if (filterVisible === 'visible' && !u.visible) return false;
    if (filterVisible === 'hidden'  &&  u.visible) return false;
    if (filterActive  === 'active'   && !u.active) return false;
    if (filterActive  === 'inactive' &&  u.active) return false;
    return true;
  });
  const allVisible   = visibleUsers.length > 0 && visibleUsers.every(u => selected.has(u.user_id));
  const someVisible  = visibleUsers.some(u => selected.has(u.user_id));

  const load = useCallback(async (q = search, off = offset) => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset: off };
      if (q) params.q = q;
      const { users, total } = await api.users.list(params);
      setUsers(users);
      setTotal(total);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [search, offset, toast]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const id = setTimeout(() => { setOffset(0); load(search, 0); }, 350);
    return () => clearTimeout(id);
  }, [search]);

  // Clear selection when page changes
  useEffect(() => { setSelected(new Set()); }, [offset, search]);

  function toggleSelect(userId, e) {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  }

  function toggleAll(e) {
    e.stopPropagation();
    if (allVisible) {
      setSelected(prev => {
        const next = new Set(prev);
        visibleUsers.forEach(u => next.delete(u.user_id));
        return next;
      });
    } else {
      setSelected(prev => {
        const next = new Set(prev);
        visibleUsers.forEach(u => next.add(u.user_id));
        return next;
      });
    }
  }

  async function handleBatchDelete() {
    setBatchDeleting(true);
    const ids = [...selected];
    let ok = 0, fail = 0;
    for (const id of ids) {
      try {
        await api.users.delete(id);
        ok++;
      } catch { fail++; }
    }
    setBatchDeleting(false);
    setBatchConfirm(false);
    setSelected(new Set());
    load(search, offset);
    if (fail > 0) toast(`${ok} eliminados, ${fail} fallaron`, 'error');
    else toast(`${ok} usuario${ok !== 1 ? 's' : ''} eliminado${ok !== 1 ? 's' : ''}`, 'success');
  }

  function setField(key, val) {
    setEditForm(f => ({ ...f, [key]: val }));
  }

  async function openEdit(user) {
    setEditForm({
      name:    user.name,
      email:   user.email ?? '',
      score:   user.score ?? 0,
      active:  user.active !== 0,
      visible: user.visible !== 0,
    });
    setEditModal(user);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await api.users.get(user.user_id);
      setDetail(data);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.users.update(editModal.user_id, {
        name:    editForm.name,
        email:   editForm.email || null,
        score:   Number(editForm.score),
        active:  editForm.active,
        visible: editForm.visible,
      });
      toast('Usuario actualizado', 'success');
      setEditModal(null);
      load(search, offset);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(user) {
    try {
      await api.users.delete(user.user_id);
      toast('Usuario eliminado', 'success');
      setConfirm(null);
      setEditModal(null);
      load(search, offset);
    } catch (e) {
      toast(e.message, 'error');
      setConfirm(null);
    }
  }

  const RESULT_LABELS = { win: 'Victoria', loss: 'Derrota', participate: 'Participó' };
  const RESULT_COLORS = { win: 'badge-green', loss: 'badge-red', participate: 'badge-gray' };

  return (
    <div>
      <div className="page-header">
        <h1>👥 Usuarios</h1>
        <div className="toolbar">
          <input
            ref={searchRef}
            className="search-input"
            placeholder="Buscar por nombre, email o ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {total.toLocaleString()} usuarios
          </span>
        </div>
      </div>

      <div className="filter-bar">
        <button className={`filter-chip ${filterTier === '' ? 'active' : ''}`} onClick={() => setFilterTier('')}>Todos</button>
        {TIERS.map(t => (
          <button key={t.name} className={`filter-chip ${filterTier === t.name ? 'active' : ''}`} onClick={() => setFilterTier(filterTier === t.name ? '' : t.name)}>{t.name}</button>
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

      {/* Batch action bar */}
      {selected.size > 0 && (
        <div className="batch-bar">
          <span className="batch-bar__count">{selected.size} seleccionado{selected.size !== 1 ? 's' : ''}</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Cancelar</button>
          <button className="btn btn-danger btn-sm" onClick={() => setBatchConfirm(true)}>
            Eliminar {selected.size}
          </button>
        </div>
      )}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : visibleUsers.length === 0 ? (
        <div className="empty-state">
          <div className="icon">👥</div>
          <p>{search || filterTier ? 'No hay resultados' : 'No hay usuarios todavía'}</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36, paddingRight: 0 }}>
                    <input
                      type="checkbox"
                      checked={allVisible}
                      ref={el => { if (el) el.indeterminate = someVisible && !allVisible; }}
                      onChange={toggleAll}
                      title="Seleccionar todos"
                    />
                  </th>
                  <th>Usuario</th>
                  <th>Puntos</th>
                  <th>Tier</th>
                  <th>Partidas</th>
                  <th>Victorias</th>
                  <th>Estado</th>
                  <th>Registro</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map(u => {
                  const tier    = getTier(u.score);
                  const checked = selected.has(u.user_id);
                  return (
                    <tr
                      key={u.user_id}
                      style={{ cursor: 'pointer', background: checked ? 'rgba(110,64,201,0.08)' : undefined }}
                      onClick={() => openEdit(u)}
                    >
                      <td style={{ paddingRight: 0 }} onClick={e => toggleSelect(u.user_id, e)}>
                        <input type="checkbox" checked={checked} onChange={() => {}} />
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 16 }}>
                            {u.picture ? <img src={u.picture} alt="" /> : u.name?.[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{u.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {u.email ?? u.user_id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{(u.score ?? 0).toLocaleString('es-ES')}</td>
                      <td><span className={`badge ${tier.color}`}>{tier.name}</span></td>
                      <td>{u.games_played ?? 0}</td>
                      <td>{u.games_won ?? 0}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <span className={`badge ${u.visible ? 'badge-green' : 'badge-gray'}`}>{u.visible ? 'Visible' : 'Oculto'}</span>
                          <span className={`badge ${u.active ? 'badge-green' : 'badge-red'}`}>{u.active ? 'Activo' : 'Inactivo'}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(u.created_at)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="td-actions">
                          <button className="btn btn-ghost btn-sm" onClick={() => openEdit(u)}>✎</button>
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(u)}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}
            </span>
            <button className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); load(search, o); }}>
              ‹ Anterior
            </button>
            <button className="btn btn-ghost btn-sm" disabled={offset + LIMIT >= total} onClick={() => { const o = offset + LIMIT; setOffset(o); load(search, o); }}>
              Siguiente ›
            </button>
          </div>
        </>
      )}

      {/* Edit modal */}
      {editModal && (
        <Modal
          title={`Editar: ${editModal.name}`}
          onClose={() => setEditModal(null)}
          onSubmit={handleSave}
          submitting={saving}
          onDelete={() => setConfirm(editModal)}
        >
          <div className="form-group">
            <label>Nombre</label>
            <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Puntos (Bules)</label>
            <input type="number" min="0" value={editForm.score} onChange={e => setEditForm(f => ({ ...f, score: e.target.value }))} />
          </div>

          <div className="toggle-row">
            <Switch checked={editForm.visible} onChange={v => setField('visible', v)} />
            <label>Visible en el ranking</label>
          </div>
          <div className="toggle-row">
            <Switch checked={editForm.active} onChange={v => setField('active', v)} disabled={!editForm.visible} />
            <label style={!editForm.visible ? { opacity: 0.5 } : undefined}>Activo (puede jugar)</label>
          </div>

          {detailLoading ? (
            <div className="loading">Cargando…</div>
          ) : detail ? (
            <>
              <div className="panel-section">
                <h3>Items ({detail.items.length})</h3>
                {detail.items.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin items</p>
                ) : (
                  <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {detail.items.map(item => (
                      <div key={item.id} className="item-chip" title={`Comprado: ${fmtDate(item.bought_at)}`}>
                        {item.image_url && <img src={item.image_url} alt="" />}
                        {item.name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel-section">
                <h3>Últimas partidas ({detail.sessions.length})</h3>
                {detail.sessions.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin partidas registradas</p>
                ) : (
                  detail.sessions.map((s, i) => (
                    <div key={i} className="session-row">
                      <span className={`badge ${RESULT_COLORS[s.result] ?? 'badge-gray'}`}>
                        {RESULT_LABELS[s.result] ?? s.result}
                      </span>
                      <span style={{ color: s.score_delta >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {s.score_delta >= 0 ? '+' : ''}{s.score_delta.toLocaleString()} ₿
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{fmtDate(s.played_at)}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : null}
        </Modal>
      )}

      {/* Single delete */}
      {confirm && (
        <Confirm
          title="¿Eliminar usuario?"
          message={`Se eliminarán todos los datos de "${confirm.name}": partidas, items, estadísticas y suscripciones push. Esta acción es irreversible.`}
          onConfirm={() => handleDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Batch delete */}
      {batchConfirm && (
        <Confirm
          title={`¿Eliminar ${selected.size} usuario${selected.size !== 1 ? 's' : ''}?`}
          message={`Se eliminarán permanentemente ${selected.size} usuario${selected.size !== 1 ? 's' : ''} con todos sus datos (partidas, items, estadísticas). Esta acción es irreversible.`}
          onConfirm={handleBatchDelete}
          onCancel={() => setBatchConfirm(false)}
        />
      )}
    </div>
  );
}
