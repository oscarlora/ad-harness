// Serves a brand file by brand-relative path (?p=…); paths outside the brand dir 403.
// A media original missing locally (light sync) redirects to a presigned R2 URL when creds exist.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { within } from '../../../../../lib/server/brands.js';
import { r2For } from '../../../../../lib/server/harness.js';
import { brandRoute, fileResponse, jsonRes } from '../../../../../lib/server/http.js';

export const dynamic = 'force-dynamic';

export const GET = brandRoute(async (req, ctx) => {
  const rel = new URL(req.url).searchParams.get('p') || '';
  if (!rel || rel.includes('\0')) return jsonRes({ error: 'bad path' }, 400);
  const abs = resolve(ctx.dir, rel);
  if (!within(ctx.dir, abs)) return jsonRes({ error: 'forbidden' }, 403);

  const relPosix = rel.replace(/\\/g, '/');
  if (!existsSync(abs) && relPosix.startsWith('inputs/media/')) {
    const r2 = await r2For(ctx.ws).catch(() => null);
    if (r2) return Response.redirect(r2.presignGet(`${ctx.brand}/${relPosix}`, 3600), 302);
  }
  return fileResponse(req, abs);
});
