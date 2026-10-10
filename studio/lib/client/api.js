// Client-side URL helpers. Brand names may contain spaces ("Acme Skincare"),
// so every path segment and query value is encoded exactly once, here.
export const brandUrl = (ws, brand, tab) => `/${encodeURIComponent(ws)}/${encodeURIComponent(brand)}/${tab}`;

// One ad's Workflow page (ad = its outputs/ folder name).
export const workflowUrl = (ws, brand, ad) => `${brandUrl(ws, brand, 'workflow')}/${encodeURIComponent(ad)}`;

export const apiBase = (ws, brand) => `/api/${encodeURIComponent(ws)}/${encodeURIComponent(brand)}`;

// Brand-relative path → the streaming file route (v = cache-buster for overwritten renders).
export const fileUrl = (ws, brand, p, v) =>
  `${apiBase(ws, brand)}/file?p=${encodeURIComponent(p)}${v ? `&v=${encodeURIComponent(v)}` : ''}`;

// An API route that answers with a PAGE rather than JSON is not a request that failed, it
// is a route the server is not serving: the app needs restarting. That happens when a dev
// server's route table drifts, and its raw "HTTP 404" sends people hunting for a bad ID
// instead of restarting. Name the real cause.
const MISSING_ROUTE = 'Studio needs a restart: the server is not serving this part of the app. Stop it and run it again, then try once more.';

async function request(url, init) {
  const r = await fetch(url, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 404 && !data.error ? MISSING_ROUTE : (data.error || `HTTP ${r.status}`));
  return data;
}

export const getJson = (url) => request(url, { cache: 'no-store' });

export const postJson = (url, body) =>
  request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Open a brand-relative file in its default app (mode 'open') or show it in the file manager ('reveal').
export const openFile = (ws, brand, p, mode) => postJson(`${apiBase(ws, brand)}/open`, { path: p, mode });
