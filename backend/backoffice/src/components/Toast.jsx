import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);

let uid = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((msg, type = 'info') => {
    const id = ++uid;
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{icons[t.type]}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
