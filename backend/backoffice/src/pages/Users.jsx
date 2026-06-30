import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import Confirm from '../components/Confirm.jsx';
import Modal from '../components/Modal.jsx';
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
  const [users, setUsers]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [offset, setOffset]     = useState(0);
  const [panel, setPanel]       = useState(null);   // selected user detail
  const [panelData, setPanelData] = useState(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [editModal, setEditModal]  = useState(null);
  const [editForm, setEditForm]    = useState({ name: '', email: '', score: 0 });
  const [saving, setSaving]        = useState(false);
  const [confirm, setConfirm]      = useState(null);
  const [filterTier, setFilterTier] = useState('');
  const LIMIT = 50;
  const searchRef = useRef(null);

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

  async function openPanel(user) {
    setPanel(user);
    setPanelData(null);
    setPanelLoading(true);
    try {
      const data = await api.users.get(user.user_id);
      setPanelData(data);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPanelLoading(false);
    }
  }

  function openEdit(user) {
    setEditForm({ name: user.name, email: user.email ?? '', score: user.score ?? 0 });
    setEditModal(user);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.users.update(editModal.user_id, {
        name:  editForm.name,
        email: editForm.email || null,
        score: Number(editForm.score),
      });
      toast('Usuario actualizado', 'success');
      setEditModal(null);
      load(search, offset);
      if (panel?.user_id === editModal.user_id) openPanel({ ...editModal, ...editForm });
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
      if (panel?.user_id === user.user_id) setPanel(null);
      load(search, offset);
    } catch (e) {
      toast(e.message, 'error');
      setConfirm(null);
    }
  }

  const RESULT_LABELS  = { win: 'Victoria', loss: 'Derrota', participate: 'Participó' };
  const RESULT_COLORS  = { win: 'badge-green', loss: 'badge-red', participate: 'badge-gray' };

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%', alignItems: 'flex-start' }}>
      {/* Main list */}
      <div style={{ flex: 1, minWidth: 0 }}>
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
        </div>

        {loading ? (
          <div className="loading">Cargando…</div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <div className="icon">👥</div>
            <p>{search ? 'No hay resultados' : 'No hay usuarios todavía'}</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Puntos</th>
                    <th>Tier</th>
                    <th>Partidas</th>
                    <th>Victorias</th>
                    <th>Registro</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.filter(u => !filterTier || getTier(u.score).name === filterTier).map(u => {
                    const tier = getTier(u.score);
                    return (
                      <tr
                        key={u.user_id}
                        style={{ cursor: 'pointer' }}
                        onClick={() => openPanel(u)}
                      >
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div className="user-avatar" style={{ width: 32, height: 32, fontSize: 16 }}>
                              {u.picture
                                ? <img src={u.picture} alt="" />
                                : u.name?.[0]?.toUpperCase() ?? '?'}
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
      </div>

      {/* Side panel */}
      {panel && (
        <>
          <div className="panel-overlay" onClick={() => setPanel(null)} />
          <div className="panel">
            <div className="panel-header">
              <h2>Detalle usuario</h2>
              <button className="modal-close" onClick={() => setPanel(null)}>✕</button>
            </div>
            <div className="panel-body">
              {panelLoading ? (
                <div className="loading">Cargando…</div>
              ) : panelData ? (
                <>
                  {/* User info */}
                  <div className="user-info">
                    <div className="user-avatar">
                      {panelData.user.picture
                        ? <img src={panelData.user.picture} alt="" />
                        : panelData.user.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="user-info-text">
                      <div className="name">{panelData.user.name}</div>
                      <div className="sub">{panelData.user.email ?? panelData.user.user_id}</div>
                      <div className="sub" style={{ fontSize: 10, marginTop: 2 }}>ID: {panelData.user.user_id}</div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="val">{(panelData.user.score ?? 0).toLocaleString('es-ES')}</div>
                      <div className="lbl">Puntos</div>
                    </div>
                    <div className="stat-card">
                      <div className="val">{panelData.user.games_played ?? 0}</div>
                      <div className="lbl">Partidas</div>
                    </div>
                    <div className="stat-card">
                      <div className="val">{panelData.user.games_won ?? 0}</div>
                      <div className="lbl">Victorias</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                    <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => openEdit(panelData.user)}>
                      ✎ Editar
                    </button>
                    <button className="btn btn-danger" onClick={() => setConfirm(panelData.user)}>
                      Eliminar
                    </button>
                  </div>

                  {/* Items */}
                  <div className="panel-section">
                    <h3>Items ({panelData.items.length})</h3>
                    {panelData.items.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin items</p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                        {panelData.items.map(item => (
                          <div key={item.id} className="item-chip" title={`Comprado: ${fmtDate(item.bought_at)}`}>
                            {item.image_url && <img src={item.image_url} alt="" />}
                            {item.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Last sessions */}
                  <div className="panel-section">
                    <h3>Últimas partidas ({panelData.sessions.length})</h3>
                    {panelData.sessions.length === 0 ? (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sin partidas registradas</p>
                    ) : (
                      panelData.sessions.map((s, i) => (
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
            </div>
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
        </Modal>
      )}

      {/* Delete confirm */}
      {confirm && (
        <Confirm
          title="¿Eliminar usuario?"
          message={`Se eliminarán todos los datos de "${confirm.name}": partidas, items, estadísticas y suscripciones push. Esta acción es irreversible.`}
          onConfirm={() => handleDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
