// Workflow progress: the ad list (no ?ad), or one ad's steps + storyboard (?ad=<ad folder>).
import { brandRoute, jsonRes } from '../../../../../lib/server/http.js';
import { workflowDetail, workflowList } from '../../../../../lib/server/workflow.js';

export const GET = brandRoute((req, ctx) => {
  const ad = new URL(req.url).searchParams.get('ad');
  if (ad == null) return jsonRes(workflowList(ctx.dir));
  const data = workflowDetail(ctx.dir, ad);
  return data ? jsonRes(data) : jsonRes({ error: 'no such ad folder' }, 404);
});
