import { boardData } from '../../../../../lib/server/ads.js';
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';

export const dynamic = 'force-dynamic';

export const GET = brandRoute((req, ctx) => jsonRes(boardData(ctx.dir)));
