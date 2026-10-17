// Where a catalog original (?id=…) lives: a presigned R2 URL (or the local file route without R2 creds),
// and its path on this device when it is here (home shown as ~), with the app that opens it.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mediaUrl } from '../../../../../lib/client/api.js';
import { r2For } from '../../../../../lib/server/tools.js';
import { defaultApp } from '../../../../../lib/server/openers.js';
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';
import { isMediaId, mediaRecord } from '../../../../../lib/server/media.js';

const LINK_TTL = 7 * 24 * 3600; // 7 days, the most a signed R2 link can last

export const GET = brandRoute(async (req, ctx) => {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!isMediaId(id)) return jsonRes({ error: 'bad id' }, 400);
  const rec = await mediaRecord(ctx.dir, id);
  if (!rec?.file?.name) return jsonRes({ error: 'no record' }, 404);
  const abs = join(ctx.dir, 'inputs', 'media', rec.file.name);
  const here = existsSync(abs);
  const onDevice = here ? abs.replace(homedir(), '~') : null;
  const app = here ? await defaultApp(abs) : '';
  const r2 = await r2For(ctx.ws).catch(() => null);
  if (!r2) return jsonRes({ url: mediaUrl(ctx.ws, ctx.brand, rec.file.name), local: true, onDevice, app, message: 'No R2 creds for this workspace — copied a local-serve URL instead.' });
  // A private bucket gets a signed link for the longest R2 allows (expires, in s); a public bucket's never lapses (null).
  return jsonRes({ url: r2.presignGet(`${ctx.brand}/inputs/media/${rec.file.name}`, LINK_TTL), local: false, expires: r2.public ? null : LINK_TTL, onDevice, app });
});
