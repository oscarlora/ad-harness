// connect-drive.mjs — one-time Google sign-in → captures a workspace's Drive refresh token into .env.
import fs from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { REPO_ROOT, parseArgs, usage } from './lib/catalog.mjs';

const HELP = `connect-drive.mjs — one-time Google sign-in for a workspace's Drive

  node tools/connect-drive.mjs <WORKSPACE> [<oauth-client.json>]

The workspace's OAuth client (Desktop) lives in workspaces/<WS>/_custom/drive-client.json, which syncs
to the team with R2; passing a client JSON stores it there. Writes <WORKSPACE>_DRIVE_CLIENT_ID /
_CLIENT_SECRET / _REFRESH_TOKEN to the repo-root .env.`;

const pos = parseArgs(process.argv.slice(2), { help: HELP })._;
const given = pos.find((a) => a.endsWith('.json')), workspace = pos.find((a) => a !== given);
if (!workspace) usage(HELP);
const PREFIX = workspace.toUpperCase();
const ENV_FILE = join(REPO_ROOT, '.env');
const wsDir = fs.readdirSync(join(REPO_ROOT, 'workspaces')).find((d) => d.toUpperCase() === PREFIX) || workspace;
const shared = join(REPO_ROOT, 'workspaces', wsDir, '_custom', 'drive-client.json');
if (given) {
  fs.mkdirSync(dirname(shared), { recursive: true });
  fs.copyFileSync(given, shared);
  console.log(`Saved the client for the team: ${shared}\nShare it: node tools/sync-brand.mjs --push workspaces/${wsDir}/_custom`);
} else if (!fs.existsSync(shared)) {
  console.error(`No ${shared}. Pull the workspace (node tools/sync-brand.mjs --pull workspaces/${wsDir}/_custom); the first\n` +
    'time, someone with the Google Cloud project downloads its OAuth client (Desktop) JSON and passes it here.');
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(shared, 'utf8'));
const c = j.installed || j.web;
if (!c) { console.error('Not an OAuth client JSON'); process.exit(1); }
const CLIENT_ID = c.client_id, CLIENT_SECRET = c.client_secret;
const PORT = 4796;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/drive';

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
  scope: SCOPE, access_type: 'offline', prompt: 'consent',
}).toString();

function upsertEnv(kv) {
  let env = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  if (env && !env.endsWith('\n')) env += '\n';
  for (const [k, v] of Object.entries(kv)) {
    const re = new RegExp(`^${k}=.*$`, 'm');
    env = re.test(env) ? env.replace(re, `${k}=${v}`) : env + `${k}=${v}\n`;
  }
  fs.writeFileSync(ENV_FILE, env);
}

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('no code'); return; }
  try {
    const tok = await (await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }).toString(),
    })).json();
    if (!tok.refresh_token) { res.writeHead(500); res.end('No refresh_token. Revoke prior access for this app at myaccount.google.com/permissions and retry.'); console.error('token response had no refresh_token:', tok.error || '(no error code)', tok.error_description || ''); setTimeout(() => process.exit(1), 100); return; }
    upsertEnv({ [`${PREFIX}_DRIVE_CLIENT_ID`]: CLIENT_ID, [`${PREFIX}_DRIVE_CLIENT_SECRET`]: CLIENT_SECRET, [`${PREFIX}_DRIVE_REFRESH_TOKEN`]: tok.refresh_token });
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Success</h2><p>Token captured. Close this tab and return to the chat.</p>');
    console.log(`DONE: wrote ${PREFIX}_DRIVE_CLIENT_ID, ${PREFIX}_DRIVE_CLIENT_SECRET, ${PREFIX}_DRIVE_REFRESH_TOKEN to .env`);
    setTimeout(() => process.exit(0), 300);
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); console.error(e); setTimeout(() => process.exit(1), 100); }
});
server.listen(PORT, () => {
  const authFile = join(tmpdir(), 'ad-production-kit_authurl.txt');
  fs.writeFileSync(authFile, authUrl + '\n');
  console.log('AUTHURL ' + authUrl);
  console.log('(also saved to ' + authFile + ')');
});
