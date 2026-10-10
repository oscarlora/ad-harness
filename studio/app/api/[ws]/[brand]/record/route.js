// Persist media-record edits. Merge semantics stay single-source: the patch is handed to
// `node tools/record-media.mjs --merge` (see lib/server/media.js). Naming an unknown person
// additionally appends to _catalog/people.json (read-modify-write here — it has no tool).
// Body: { id, patch, addPeople?: [{ name, description }] }
import { brandPost, jsonRes } from '../../../../../lib/server/http.js';
import { addPeople, isMediaId, mergeMediaRecord } from '../../../../../lib/server/media.js';

export const dynamic = 'force-dynamic';

export const POST = brandPost(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const { id, patch } = body;
  if (!isMediaId(id) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return jsonRes({ error: 'valid id and patch object required' }, 400);
  }
  delete patch.id; // the route's id wins
  const record = await mergeMediaRecord(ctx.dir, id, patch);
  if (Array.isArray(body.addPeople) && body.addPeople.length) await addPeople(ctx.dir, body.addPeople);
  return jsonRes({ ok: true, record });
});
