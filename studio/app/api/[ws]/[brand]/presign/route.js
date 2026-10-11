// Presigned R2 URL for a catalog original (?id=…), or the local file route without R2 creds.
import { r2For } from '../../../../../lib/server/harness.js';
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';
import { isMediaId, mediaRecord } from '../../../../../lib/server/media.js';

export const dynamic = 'force-dynamic';

export const GET = brandRoute(async (req, ctx) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!isMediaId(id)) return jsonRes({ error: 'bad id' }, 400);
  const rec = await mediaRecord(ctx.dir, id);
  if (!rec?.file?.name) return jsonRes({ error: 'no record' }, 404);
  const r2 = await r2For(ctx.ws).catch(() => null);
  if (!r2) {
    const local = `/api/${encodeURIComponent(ctx.ws)}/${encodeURIComponent(ctx.brand)}/file?p=${encodeURIComponent(`inputs/media/${rec.file.name}`)}`;
    return jsonRes({ url: local, local: true, message: 'No R2 creds for this workspace — copied a local-serve URL instead.' });
  }
  return jsonRes({ url: r2.presignGet(`${ctx.brand}/inputs/media/${rec.file.name}`, 3600), local: false });
});
