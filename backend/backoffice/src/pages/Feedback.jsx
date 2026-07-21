import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import Confirm from '../components/Confirm.jsx';
import { useToast } from '../components/Toast.jsx';

function fmtDate(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function Feedback() {
  const toast = useToast();
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset]   = useState(0);
  const [viewing, setViewing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const LIMIT = 50;

  const load = useCallback(async (off = offset) => {
    setLoading(true);
    try {
      const { items, total } = await api.feedback.list({ limit: LIMIT, offset: off });
      setItems(items);
      setTotal(total);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [offset, toast]);

  useEffect(() => { load(0); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDelete(item) {
    try {
      await api.feedback.delete(item.id);
      toast('Mensaje eliminado', 'success');
      setConfirm(null);
      setViewing(null);
      load(offset);
    } catch (e) {
      toast(e.message, 'error');
      setConfirm(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>💬 Quejas y sugerencias</h1>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {total.toLocaleString()} mensajes
        </span>
      </div>

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <div className="icon">💬</div>
          <p>No hay mensajes todavía</p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Mensaje</th>
                  <th>Fecha</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.id} style={{ cursor: 'pointer' }} onClick={() => setViewing(it)}>
                    <td>{it.name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td>{it.email || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                    <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.message}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{fmtDate(it.created_at)}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <div className="td-actions">
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(it)}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {offset + 1}–{Math.min(offset + LIMIT, total)} de {total}
            </span>
            <button className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => { const o = Math.max(0, offset - LIMIT); setOffset(o); load(o); }}>
              ‹ Anterior
            </button>
            <button className="btn btn-ghost btn-sm" disabled={offset + LIMIT >= total} onClick={() => { const o = offset + LIMIT; setOffset(o); load(o); }}>
              Siguiente ›
            </button>
          </div>
        </>
      )}

      {viewing && (
        <div className="modal-overlay" onClick={() => setViewing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{viewing.name || 'Mensaje'}</h2>
              <button className="modal-close" onClick={() => setViewing(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Email</label>
                <p>{viewing.email || '—'}</p>
              </div>
              <div className="form-group">
                <label>Fecha</label>
                <p>{fmtDate(viewing.created_at)}</p>
              </div>
              <div className="form-group">
                <label>Mensaje</label>
                <p style={{ whiteSpace: 'pre-wrap' }}>{viewing.message}</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-danger" onClick={() => setConfirm(viewing)}>Eliminar</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn-secondary" onClick={() => setViewing(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <Confirm
          title="¿Eliminar mensaje?"
          message="Esta acción es irreversible."
          onConfirm={() => handleDelete(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
