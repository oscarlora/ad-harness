// notion.mjs — the Notion plumbing shared by sync-to-notion and pull-notion-comments: the
// workspace's token, an API caller, and Ads Board resolution. Zero npm deps (plain fetch).
// Notion is per-workspace and optional: <WORKSPACE>_NOTION_TOKEN in .env.
import { loadEnv } from './catalog.mjs';

// { headers, api } for a workspace. Exits with setup help when the workspace has no token.
export function notionClient(workspace) {
  const W = (workspace || '').toUpperCase();
  if (!W) { console.error('Could not determine the workspace (need a path under workspaces/<Workspace>/<Brand>/, or pass <Workspace>).'); process.exit(1); }
  const token = loadEnv()[`${W}_NOTION_TOKEN`];
  if (!token) { console.error(`Workspace ${W} has no Notion configured (set ${W}_NOTION_TOKEN in .env). Notion sync is only for workspaces that review on Notion.`); process.exit(1); }
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': '2022-06-28' };
  const api = (p, method = 'GET', body) =>
    fetch('https://api.notion.com/v1' + p, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then((r) => r.json());
  return { headers, api };
}

export const plain = (rt) => (rt || []).map((t) => t.plain_text).join('');
export const titleOf = (d) => plain(d.title);

// Board resolution: boardId wins; else databases whose title contains `board` or `brand`
// (case-insensitive), preferring a single "Ads Board" among several. Returns { id, title, candidates }
// — id null when no single board matched.
export async function resolveBoard(api, { boardId, board, brand }) {
  if (boardId) return { id: boardId, title: titleOf(await api(`/databases/${boardId}`)), candidates: [] };
  const term = (board || brand || '').toLowerCase();
  if (!term) throw new Error('need boardId, board, or brand');
  const s = await api('/search', 'POST', { filter: { property: 'object', value: 'database' }, page_size: 100 });
  const all = (s.results || []).filter((d) => titleOf(d).toLowerCase().includes(term));
  let cands = all;
  if (cands.length > 1) { const ads = cands.filter((d) => /ads board/i.test(titleOf(d))); if (ads.length === 1) cands = ads; }
  return cands.length === 1 ? { id: cands[0].id, title: titleOf(cands[0]), candidates: all } : { id: null, title: null, candidates: all };
}
