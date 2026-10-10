// Small HTTP helpers shared by the route handlers: brand-scoped route wrapping (and its guarded
// write form), JSON responses, and Range-aware file streaming (video seeks without re-downloading).
import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { brandCtx } from './brands.js';
import { catalogLib } from './harness.js';

export const jsonRes = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Wrap an /api/[ws]/[brand]/* handler: resolves the brand (404 when unknown) and turns a throw
// into a 500. The handler gets (req, ctx) with ctx = { ws, brand, dir }.
export const brandRoute = (handler) => async (req, { params }) => {
  try {
    const ctx = await brandCtx(params);
    if (!ctx) return jsonRes({ error: 'unknown brand' }, 404);
    return await handler(req, ctx);
  } catch (e) {
    return jsonRes({ error: String(e?.message || e) }, 500);
  }
};

// Writes (and opening files) come only from this machine's own pages. A JSON content type cannot
// be sent cross-site without a CORS preflight, which is never granted; Origin and Host must both
// be local, which also stops DNS rebinding and LAN access when STUDIO_HOST widens the bind.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
function refuseForeign(req) {
  const type = (req.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') return jsonRes({ error: 'Content-Type must be application/json' }, 415);
  const origin = req.headers.get('origin');
  let originHost = '';
  try { originHost = origin ? new URL(origin).host : ''; } catch {}
  if ((origin && !LOCAL_HOST.test(originHost)) || !LOCAL_HOST.test(req.headers.get('host') || '')) {
    return jsonRes({ error: 'forbidden: local requests only' }, 403);
  }
  return null;
}

// brandRoute for any non-GET handler: refuses non-local or non-JSON requests first.
export const brandPost = (handler) => brandRoute((req, ctx) => refuseForeign(req) || handler(req, ctx));

// Stream a local file, honouring Range requests (206 + Content-Range).
export async function fileResponse(req, abs) {
  let st = null;
  try { st = abs && statSync(abs); } catch {}
  if (!st?.isFile()) return jsonRes({ error: 'not found' }, 404);
  const { mimeOf } = await catalogLib();
  const size = st.size;
  const type = mimeOf(abs);
  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? +m[1] : 0;
    const end = m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new Response(Readable.toWeb(createReadStream(abs, { start, end })), {
      status: 206,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }
  return new Response(Readable.toWeb(createReadStream(abs)), {
    status: 200,
    headers: {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Length': String(size),
      'Cache-Control': 'no-cache',
    },
  });
}
