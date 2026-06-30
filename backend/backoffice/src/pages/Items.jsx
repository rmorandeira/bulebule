import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { imgSrc } from '../config.js';
import Modal from '../components/Modal.jsx';
import Confirm from '../components/Confirm.jsx';
import { useToast } from '../components/Toast.jsx';

const CATEGORIES = ['collectible', 'landmark', 'figure', 'dice', 'pack'];

const CAT_BADGE = {
  collectible: 'badge-blue',
  landmark:    'badge-purple',
  figure:      'badge-yellow',
  dice:        'badge-gray',
  pack:        'badge-green',
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
  id: '', name: '', description: '', price: 0,
  image_url: '', texture_url: '', category: 'collectible',
  available: true, sale_start: '', sale_end: '', sort_order: 0,
};

function ItemPanel({ item, onEdit, onDelete, onClose }) {
  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="panel">
        <div className="panel-header">
          <h2>Detalle item</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="panel-body">
          {/* Image */}
          {item.image_url && (
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <img
                src={imgSrc(item.image_url)}
                alt={item.name}
                style={{ maxWidth: 160, maxHeight: 160, objectFit: 'contain', borderRadius: 8, background: 'var(--surface2)', padding: 12 }}
              />
            </div>
          )}

          {/* Name + ID */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{item.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>ID: {item.id}</div>
          </div>

          {/* Badges */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            <span className={`badge ${CAT_BADGE[item.category] ?? 'badge-gray'}`}>{item.category}</span>
            <span className={`badge ${item.available ? 'badge-green' : 'badge-red'}`}>
              {item.available ? 'Disponible' : 'No disponible'}
            </span>
          </div>

          {/* Description */}
          {item.description && (
            <div className="panel-section">
              <h3>Descripción</h3>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}
                dangerouslySetInnerHTML={{ __html: item.description }} />
            </div>
          )}

          {/* Details */}
          <div className="panel-section">
            <h3>Datos</h3>
            <table style={{ width: '100%', fontSize: 13 }}>
              <tbody>
                <tr>
                  <td style={{ color: 'var(--text-muted)', paddingBottom: 6, width: '40%' }}>Precio</td>
                  <td style={{ fontWeight: 600 }}>{item.price.toLocaleString('es-ES')} ₿</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--text-muted)', paddingBottom: 6 }}>Orden</td>
                  <td>{item.sort_order ?? 0}</td>
                </tr>
                {(item.sale_start || item.sale_end) && (
                  <tr>
                    <td style={{ color: 'var(--text-muted)', paddingBottom: 6 }}>Período venta</td>
                    <td>{fmtDate(item.sale_start)} – {fmtDate(item.sale_end)}</td>
                  </tr>
                )}
                {item.texture_url && (
                  <tr>
                    <td style={{ color: 'var(--text-muted)', paddingBottom: 6 }}>Textura</td>
                    <td style={{ fontSize: 11, wordBreak: 'break-all' }}>{item.texture_url}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Texture preview */}
          {item.texture_url && (
            <div className="panel-section">
              <h3>Preview textura</h3>
              <img
                src={imgSrc(item.texture_url)}
                alt="textura"
                style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, background: 'var(--surface2)' }}
              />
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={onEdit}>✎ Editar</button>
            <button className="btn btn-danger" onClick={onDelete}>Eliminar</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Items() {
  const toast = useToast();
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState(null);   // item shown in panel
  const [editModal, setEditModal] = useState(null);  // null | 'create' | item
  const [form, setForm]       = useState(EMPTY_FORM);
  const [saving, setSaving]   = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await api.items.list();
      setItems(items);
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

  function openEdit(item) {
    setForm({
      id:          item.id,
      name:        item.name,
      description: item.description ?? '',
      price:       item.price,
      image_url:   item.image_url ?? '',
      texture_url: item.texture_url ?? '',
      category:    item.category,
      available:   item.available === 1,
      sale_start:  tsToDatetimeLocal(item.sale_start),
      sale_end:    tsToDatetimeLocal(item.sale_end),
      sort_order:  item.sort_order ?? 0,
    });
    setEditModal(item);
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
      price:       Number(form.price),
      sort_order:  Number(form.sort_order),
      sale_start:  datetimeLocalToTs(form.sale_start),
      sale_end:    datetimeLocalToTs(form.sale_end),
      texture_url: form.texture_url || null,
      description: form.description || null,
      image_url:   form.image_url || null,
    };
    try {
      if (editModal === 'create') {
        await api.items.create(payload);
        toast('Item creado', 'success');
      } else {
        await api.items.update(editModal.id, payload);
        toast('Item actualizado', 'success');
        // Sync panel with updated data
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

  async function handleDelete(item) {
    try {
      await api.items.delete(item.id);
      toast('Item eliminado', 'success');
      setConfirm(null);
      setSelected(null);
      load();
    } catch (e) {
      toast(e.message, 'error');
      setConfirm(null);
    }
  }

  const filtered = items.filter(i =>
    !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.id.includes(search.toLowerCase())
  );

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="page-header">
          <h1>🎁 Items</h1>
          <div className="toolbar">
            <input
              className="search-input"
              placeholder="Buscar por nombre o ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button className="btn btn-primary" onClick={openCreate}>+ Nuevo item</button>
          </div>
        </div>

        {loading ? (
          <div className="loading">Cargando…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🎁</div>
            <p>{search ? 'No hay resultados' : 'No hay items todavía'}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Categoría</th>
                  <th>Precio</th>
                  <th>Estado</th>
                  <th>Venta</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr
                    key={item.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelected(item)}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {item.image_url ? (
                          <img
                            src={imgSrc(item.image_url)}
                            alt=""
                            style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4, background: 'var(--surface2)', flexShrink: 0 }}
                            onError={e => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <div style={{ width: 32, height: 32, background: 'var(--surface2)', borderRadius: 4, flexShrink: 0 }} />
                        )}
                        <div>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.id}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${CAT_BADGE[item.category] ?? 'badge-gray'}`}>
                        {item.category}
                      </span>
                    </td>
                    <td>{item.price.toLocaleString('es-ES')} ₿</td>
                    <td>
                      <span className={`badge ${item.available ? 'badge-green' : 'badge-red'}`}>
                        {item.available ? 'Activo' : 'Inactivo'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {item.sale_start || item.sale_end
                        ? `${fmtDate(item.sale_start)} – ${fmtDate(item.sale_end)}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <ItemPanel
          item={selected}
          onClose={() => setSelected(null)}
          onEdit={() => openEdit(selected)}
          onDelete={() => setConfirm(selected)}
        />
      )}

      {/* Edit / Create modal */}
      {editModal && (
        <Modal
          title={editModal === 'create' ? 'Nuevo item' : `Editar: ${editModal.name}`}
          onClose={() => setEditModal(null)}
          onSubmit={handleSave}
          submitting={saving}
        >
          <div className="form-row">
            <div className="form-group">
              <label>Nombre *</label>
              <input value={form.name} onChange={field('name')} required placeholder="Torre de Hércules" />
            </div>
            <div className="form-group">
              <label>ID *</label>
              <input
                value={form.id}
                onChange={field('id')}
                required
                placeholder="torre-hercules"
                disabled={editModal !== 'create'}
                style={editModal !== 'create' ? { opacity: 0.5 } : undefined}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Descripción</label>
            <textarea value={form.description} onChange={field('description')} placeholder="Descripción del item…" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Categoría</label>
              <select value={form.category} onChange={field('category')}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Precio (Bules)</label>
              <input type="number" min="0" value={form.price} onChange={field('price')} />
            </div>
          </div>

          <div className="form-group">
            <label>URL imagen portada</label>
            <input value={form.image_url} onChange={field('image_url')} placeholder="/assets/items/mi-item.png" />
            {form.image_url && (
              <img src={imgSrc(form.image_url)} alt="" style={{ marginTop: 6, height: 48, objectFit: 'contain', borderRadius: 4 }} onError={e => { e.target.style.display = 'none'; }} />
            )}
          </div>

          {form.category === 'dice' && (
            <div className="form-group">
              <label>URL textura dado</label>
              <input value={form.texture_url} onChange={field('texture_url')} placeholder="/assets/dice/mi-textura.png" />
              {form.texture_url && (
                <img src={imgSrc(form.texture_url)} alt="" style={{ marginTop: 6, height: 48, objectFit: 'contain', borderRadius: 4 }} onError={e => { e.target.style.display = 'none'; }} />
              )}
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Inicio venta</label>
              <input type="datetime-local" value={form.sale_start} onChange={field('sale_start')} />
            </div>
            <div className="form-group">
              <label>Fin venta</label>
              <input type="datetime-local" value={form.sale_end} onChange={field('sale_end')} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Orden</label>
              <input type="number" min="0" value={form.sort_order} onChange={field('sort_order')} />
            </div>
          </div>

          <div className="toggle-row">
            <input type="checkbox" id="available" checked={form.available} onChange={field('available')} />
            <label htmlFor="available">Disponible en el marketplace</label>
          </div>
        </Modal>
      )}

      {confirm && (
        <Confirm
          title="¿Eliminar item?"
          message={`Se eliminará "${confirm.name}" de forma permanente. Si algún usuario lo posee, la operación se bloqueará.`}
          onConfirm={() => handleDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
