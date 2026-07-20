const BASE = import.meta.env.VITE_API_URL || '';

function getToken() {
  return localStorage.getItem('admin_token') || '';
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...options.headers,
    },
  });
  if (res.status === 401) throw Object.assign(new Error('No autorizado'), { status: 401 });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

export const api = {
  items: {
    list:   ()           => apiFetch('/api/admin/items'),
    create: (data)       => apiFetch('/api/admin/items', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data)   => apiFetch(`/api/admin/items/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id)         => apiFetch(`/api/admin/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  tournaments: {
    list:   ()           => apiFetch('/api/admin/tournaments'),
    create: (data)       => apiFetch('/api/admin/tournaments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data)   => apiFetch(`/api/admin/tournaments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id)         => apiFetch(`/api/admin/tournaments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  upload: (base64, filename) => apiFetch('/api/admin/upload', { method: 'POST', body: JSON.stringify({ data: base64, filename }) }),
  users: {
    list:   (params = {})  => apiFetch(`/api/admin/users?${new URLSearchParams(params)}`),
    get:    (id)           => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`),
    update: (id, data)     => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id)           => apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },
  settings: {
    get:    ()             => apiFetch('/api/admin/settings'),
    update: (data)         => apiFetch('/api/admin/settings', { method: 'PUT', body: JSON.stringify(data) }),
  },
};
