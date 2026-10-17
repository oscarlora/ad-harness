import { boardData } from '../../../../../lib/server/ads.js';
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';

export const GET = brandRoute(async (req, ctx) => jsonRes(await boardData(ctx.dir)));
