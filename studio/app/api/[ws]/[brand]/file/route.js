// Serves a brand file by brand-relative path (?p=…); paths outside the brand dir 403.
// A media original missing locally (light sync) redirects to a presigned R2 URL when creds exist.
// &w=<px> serves an image fit within px instead: made once per file version, cached outside the brand.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { within } from '../../../../../lib/server/brands.js';
import { catalogLib, r2For } from '../../../../../lib/server/harness.js';
import { brandRoute, fileResponse, jsonRes } from '../../../../../lib/server/http.js';

export const dynamic = 'force-dynamic';

const THUMBS = join(tmpdir(), 'ad-harness-thumbs');

// The fitted copy's path, or the original when it isn't an image or can't be resized.
async function fitted(abs, w) {
  const { typeOf, imageFitCmd, runAsync } = await catalogLib();
  let st = null;
  try { st = statSync(abs); } catch { return abs; }
  if (typeOf(abs) !== 'image') return abs;
  const px = Math.min(2048, Math.max(64, Math.round(w)));
  const out = join(THUMBS, `${createHash('sha1').update(`${abs}|${st.mtimeMs}|${px}`).digest('hex')}.jpg`);
  if (existsSync(out)) return out;
  mkdirSync(THUMBS, { recursive: true });
  const tmp = `${out.slice(0, -4)}.${process.pid}.${Date.now()}.jpg`; // concurrent requests never see half a file
  const [bin, args] = imageFitCmd(abs, px, tmp);
  await runAsync(bin, args, { allowFail: true });
  try { renameSync(tmp, out); return out; } catch { return abs; }
}

export const GET = brandRoute(async (req, ctx) => {
  const q = new URL(req.url).searchParams;
  const rel = q.get('p') || '';
  if (!rel || rel.includes('\0')) return jsonRes({ error: 'bad path' }, 400);
  const abs = resolve(ctx.dir, rel);
  if (!within(ctx.dir, abs)) return jsonRes({ error: 'forbidden' }, 403);

  const relPosix = rel.replace(/\\/g, '/');
  if (!existsSync(abs) && relPosix.startsWith('inputs/media/')) {
    const r2 = await r2For(ctx.ws).catch(() => null);
    if (r2) return Response.redirect(r2.presignGet(`${ctx.brand}/${relPosix}`, 3600), 302);
  }
  return fileResponse(req, q.get('w') ? await fitted(abs, +q.get('w') || 800) : abs);
});
