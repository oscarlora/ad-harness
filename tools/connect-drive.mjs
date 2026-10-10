// connect-drive.mjs — one-time OAuth consent → captures a workspace's Drive refresh token into .env.
// Usage: node tools/connect-drive.mjs <oauth-client.json> <WORKSPACE>
// Starts a localhost server, prints an auth URL; after you click Allow it writes
//   <WORKSPACE>_DRIVE_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN to the repo-root .env.
import fs from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT, parseArgs } from './lib/catalog.mjs';

const [clientPath, workspace] = parseArgs(process.argv.slice(2))._;
if (!clientPath || !workspace) { console.error('Usage: node tools/connect-drive.mjs <oauth-client.json> <WORKSPACE>'); process.exit(1); }
const PREFIX = workspace.toUpperCase();
const ENV_FILE = join(REPO_ROOT, '.env');
const j = JSON.parse(fs.readFileSync(clientPath, 'utf8'));
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
  const authFile = join(tmpdir(), 'ad-harness_authurl.txt');
  fs.writeFileSync(authFile, authUrl + '\n');
  console.log('AUTHURL ' + authUrl);
  console.log('(also saved to ' + authFile + ')');
});
