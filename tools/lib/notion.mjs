// notion.mjs — shared Notion helpers: token, API caller, Ads Board resolution.
// Optional per workspace: <WS>_NOTION_TOKEN in .env.
import { loadEnv, readUploads } from './catalog.mjs';

// Exits with setup help when the workspace has no token.
export function notionClient(workspace) {
  const W = (workspace || '').toUpperCase();
  if (!W) { console.error('Could not determine the workspace (need a path under workspaces/<Workspace>/<Brand>/, or pass <Workspace>).'); process.exit(1); }
  const token = loadEnv()[`${W}_NOTION_TOKEN`];
  if (!token) { console.error(`Workspace ${W} has no Notion configured (set ${W}_NOTION_TOKEN in .env). Notion is only for workspaces that review on Notion.`); process.exit(1); }
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' };
  const api = (p, method = 'GET', body) =>
    fetch('https://api.notion.com/v1' + p, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  return { headers, api };
}

export const plain = (rt) => (rt || []).map((t) => t.plain_text).join('');
export const titleOf = (d) => plain(d.title);

// The board lookup for a brand: the spec's board/boardId, else the one pinned in the brand's
// inputs/uploads.json, else a search on spec.brand. `brandPath` is any path inside the brand, or null.
export const boardQuery = (spec, brandPath) => (spec.board || spec.boardId || !brandPath ? spec : { ...spec, ...readUploads(brandPath).notion });

// boardId wins; else a database titled with `board` or `brand`, preferring an exact title, then a
// single "Ads Board". id is null when no single board matched.
export async function resolveBoard(api, { boardId, board, brand }) {
  if (boardId) { const db = await api(`/databases/${boardId}`); return { id: boardId, title: titleOf(db), candidates: [db] }; }
  const term = (board || brand || '').toLowerCase();
  if (!term) throw new Error('need boardId, board, or brand');
  const s = await api('/search', 'POST', { filter: { property: 'object', value: 'database' }, page_size: 100 });
  const all = (s.results || []).filter((d) => titleOf(d).toLowerCase().includes(term));
  let cands = all;
  const exact = cands.filter((d) => titleOf(d).toLowerCase() === term);
  if (exact.length === 1) cands = exact;
  if (cands.length > 1) { const ads = cands.filter((d) => /ads board/i.test(titleOf(d))); if (ads.length === 1) cands = ads; }
  return cands.length === 1 ? { id: cands[0].id, title: titleOf(cands[0]), candidates: all } : { id: null, title: null, candidates: all };
}
