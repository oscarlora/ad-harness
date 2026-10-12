// Client URL helpers. Every path segment and query value is encoded once, here (brand names have spaces).
export const brandUrl = (ws, brand, tab) => `/${encodeURIComponent(ws)}/${encodeURIComponent(brand)}/${tab}`;

// ad = its outputs/ folder name.
export const workflowUrl = (ws, brand, ad) => `${brandUrl(ws, brand, 'workflow')}/${encodeURIComponent(ad)}`;

export const apiBase = (ws, brand) => `/api/${encodeURIComponent(ws)}/${encodeURIComponent(brand)}`;

// v = cache-buster for overwritten renders; w = serve an image fit within w px (a thumbnail).
export const fileUrl = (ws, brand, p, v, w) =>
  `${apiBase(ws, brand)}/file?p=${encodeURIComponent(p)}${v ? `&v=${encodeURIComponent(v)}` : ''}${w ? `&w=${w}` : ''}`;

// A media-library file (relative to inputs/media/) as a brand-relative path.
export const mediaPath = (p) => `inputs/media/${p}`;

// A 404 without a JSON error means the server isn't serving the route (dev route-table drift): say restart.
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

// mode: 'open' (default app) or 'reveal' (file manager).
export const openFile = (ws, brand, p, mode) => postJson(`${apiBase(ws, brand)}/open`, { path: p, mode });
