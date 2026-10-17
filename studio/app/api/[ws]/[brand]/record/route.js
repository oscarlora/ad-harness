// Saves a media record's sidebar edits (lib/server/media.js); new people go to _catalog/people.json.
// Body: { id, patch, addPeople?: [{ name, description }] }
import { brandPost, jsonRes } from '../../../../../lib/server/http.js';
import { addPeople, isMediaId, mergeMediaRecord } from '../../../../../lib/server/media.js';

export const POST = brandPost(async (req, ctx) => {
  const body = await req.json().catch(() => ({}));
  const { id, patch } = body;
  if (!isMediaId(id) || typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return jsonRes({ error: 'valid id and patch object required' }, 400);
  }
  delete patch.id;
  const record = await mergeMediaRecord(ctx.dir, id, patch);
  if (Array.isArray(body.addPeople) && body.addPeople.length) await addPeople(ctx.dir, body.addPeople);
  return jsonRes({ ok: true, record });
});
