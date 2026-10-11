// An ad's edit. Body: { ad, note } saves a review note, { ad, approve: id } approves one, { ad, remove: id } deletes one, { ad, export: plan } starts an export.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { approveNote, removeNote, saveNote, startExport } from '../../../../../lib/server/edit.js';
import { brandPost, jsonRes } from '../../../../../lib/server/http.js';

export const dynamic = 'force-dynamic';

export const POST = brandPost(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const ad = String(body.ad || '');
  if (!/^\d+_[^/\\\0]+$/.test(ad) || !existsSync(join(ctx.dir, 'outputs', ad))) return jsonRes({ error: 'no such ad folder' }, 404);
  try {
    if (body.note) return jsonRes({ note: saveNote(ctx.dir, ad, body.note) });
    if (body.approve) { approveNote(ctx.dir, ad, body.approve); return jsonRes({ ok: true }); }
    if (body.remove) { removeNote(ctx.dir, ad, body.remove); return jsonRes({ ok: true }); }
    if (body.export) { startExport(ctx.dir, ad, body.export); return jsonRes({ ok: true }); }
  } catch (e) {
    return jsonRes({ error: String(e.message || e) }, 400);
  }
  return jsonRes({ error: 'nothing to do' }, 400);
});
