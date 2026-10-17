import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';
import { mediaRecords } from '../../../../../lib/server/media.js';

export const GET = brandRoute(async (req, ctx) => jsonRes({ records: await mediaRecords(ctx.dir) }));
