import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { imgSrc } from '../config.js';
import Modal from '../components/Modal.jsx';
import Confirm from '../components/Confirm.jsx';
import Switch from '../components/Switch.jsx';
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

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Maps dice item IDs to their texture image paths (served by Firebase)
const DICE_TEXTURE = {
  'dice-marble':       '/assets/dice/marble-texture.png',
  'dice-marble-black': '/assets/dice/marble-black-texture.png',
  'dice-marble-red':   '/assets/dice/marble-red-texture.png',
  'dice-marble-green': '/assets/dice/marble-green-texture.png',
};

function deriveDiceTexture(id, stored) {
  if (stored) return stored;
  return DICE_TEXTURE[id] ?? '';
}

const EMPTY_FORM = {
  id: '', name: '', description: '', price: 0,
  image_url: '', texture_url: '', category: 'collectible',
  active: true, visible: true, sale_start: '', sale_end: '', sort_order: 0,
};

function UploadableImage({ src, alt, style, onUpload, uploading }) {
  const ref = useRef(null);
  return (
    <div
      className="img-upload"
      style={style}
      onClick={() => !uploading && ref.current?.click()}
      title="Clic para cambiar imagen"
    >
      {src
        ? <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} onError={e => { e.target.style.display = 'none'; }} />
        : <div style={{ width: '100%', height: '100%', background: 'var(--surface3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Sin imagen</div>
      }
      <div className="img-upload__overlay">{uploading ? '⏳' : '📷'}</div>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files[0]) onUpload(e.target.files[0]); e.target.value = ''; }}
      />
    </div>
  );
}

export default function Items() {
  const toast = useToast();
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]         = useState('');
  const [filterCat, setFilterCat]   = useState('');
  const [filterVisible, setFilterVisible] = useState('');
  const [filterActive, setFilterActive] = useState('');
  const [editModal, setEditModal] = useState(null);
  const [form, setForm]           = useState(EMPTY_FORM);
  const [saving, setSaving]       = useState(false);
  const [uploading, setUploading] = useState(null);
  const [confirm, setConfirm]     = useState(null);

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
      texture_url: item.category === 'dice' ? deriveDiceTexture(item.id, item.texture_url) : (item.texture_url ?? ''),
      category:    item.category,
      active:      item.active === 1,
      visible:     item.visible === 1,
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

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function handleUploadImage(fieldKey, file) {
    setUploading(fieldKey);
    try {
      const base64 = await readFileAsBase64(file);
      const { url } = await api.upload(base64, file.name);
      setForm(f => ({ ...f, [fieldKey]: url }));
      toast('Imagen subida', 'success');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setUploading(null);
    }
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
      setEditModal(null);
      load();
    } catch (e) {
      toast(e.message, 'error');
      setConfirm(null);
    }
  }

  const filtered = items.filter(i => {
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !i.id.includes(search.toLowerCase())) return false;
    if (filterCat && i.category !== filterCat) return false;
    if (filterVisible === 'visible' && !i.visible) return false;
    if (filterVisible === 'hidden' && i.visible) return false;
    if (filterActive === 'active' && !i.active) return false;
    if (filterActive === 'inactive' && i.active) return false;
    return true;
  });

  return (
    <div>
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

      <div className="filter-bar">
        <button className={`filter-chip ${filterCat === '' ? 'active' : ''}`} onClick={() => setFilterCat('')}>Todos</button>
        {CATEGORIES.map(c => (
          <button key={c} className={`filter-chip ${filterCat === c ? 'active' : ''}`} onClick={() => setFilterCat(filterCat === c ? '' : c)}>{c}</button>
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
                <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(item)}>
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
                  <td><span className={`badge ${CAT_BADGE[item.category] ?? 'badge-gray'}`}>{item.category}</span></td>
                  <td>{item.price.toLocaleString('es-ES')} ₿</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <span className={`badge ${item.visible ? 'badge-green' : 'badge-gray'}`}>{item.visible ? 'Visible' : 'Oculto'}</span>
                      <span className={`badge ${item.active ? 'badge-green' : 'badge-red'}`}>{item.active ? 'Activo' : 'Inactivo'}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {item.sale_start || item.sale_end ? `${fmtDate(item.sale_start)} – ${fmtDate(item.sale_end)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editModal && (
        <Modal
          title={editModal === 'create' ? 'Nuevo item' : `Editar: ${editModal.name}`}
          onClose={() => { setEditModal(null); setUploading(null); }}
          onSubmit={handleSave}
          submitting={saving}
          onDelete={editModal !== 'create' ? () => setConfirm(editModal) : undefined}
          wide
        >
          <div style={{ display: 'flex', gap: 16, marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Imagen portada</div>
              <UploadableImage
                src={imgSrc(form.image_url)}
                alt="portada"
                style={{ width: 100, height: 100, borderRadius: 8, background: 'var(--surface2)' }}
                onUpload={f => handleUploadImage('image_url', f)}
                uploading={uploading === 'image_url'}
              />
            </div>
            {form.category === 'dice' && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Textura dado</div>
                <UploadableImage
                  src={imgSrc(form.texture_url)}
                  alt="textura"
                  style={{ width: 100, height: 100, borderRadius: 8, background: 'var(--surface2)' }}
                  onUpload={f => handleUploadImage('texture_url', f)}
                  uploading={uploading === 'texture_url'}
                />
              </div>
            )}
          </div>

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
            <Switch checked={form.visible} onChange={v => setField('visible', v)} />
            <label>Visible en el marketplace</label>
          </div>
          <div className="toggle-row">
            <Switch checked={form.active} onChange={v => setField('active', v)} disabled={!form.visible} />
            <label style={!form.visible ? { opacity: 0.5 } : undefined}>Activo (comprable)</label>
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
