import { r2For } from '../../../../../lib/server/harness.js';
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';
import { mediaRecords, readPeople } from '../../../../../lib/server/media.js';

export const dynamic = 'force-dynamic';

export const GET = brandRoute(async (req, ctx) => {
  const [records, people, r2] = await Promise.all([
    mediaRecords(ctx.dir),
    readPeople(ctx.dir),
    r2For(ctx.ws).catch(() => null),
  ]);
  return jsonRes({ records, people, hasR2: !!r2 });
});
