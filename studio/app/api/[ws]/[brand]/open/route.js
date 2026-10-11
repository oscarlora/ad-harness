// Open a brand file, or reveal it in the file manager. Body: { path (brand-relative), mode?: 'open' | 'reveal' }
import { brandPost, jsonRes } from '../../../../../lib/server/http.js';
import { openPath } from '../../../../../lib/server/openers.js';

export const dynamic = 'force-dynamic';

export const POST = brandPost(async (req, ctx) => {
  const { path, mode } = await req.json().catch(() => ({}));
  const r = openPath(ctx.dir, path, mode === 'reveal' ? 'reveal' : 'open');
  return r.ok ? jsonRes({ ok: true }) : jsonRes({ error: r.error }, r.status);
});
