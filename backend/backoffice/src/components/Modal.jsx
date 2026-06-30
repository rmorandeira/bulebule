import React, { useEffect } from 'react';

export default function Modal({ title, onClose, onSubmit, submitting, children, wide }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        style={wide ? { maxWidth: 720 } : undefined}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form
          className="modal-body"
          id="modal-form"
          onSubmit={e => { e.preventDefault(); onSubmit?.(); }}
        >
          {children}
        </form>
        {onSubmit && (
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" form="modal-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
