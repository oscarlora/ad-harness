// r2.mjs — Cloudflare R2 (S3-compatible) client with AWS SigV4 signing from scratch.
// Zero dependencies (node:crypto + fetch). One bucket per workspace; the bucket mirrors the
// workspace's whole brand trees 1:1 (<Brand>/...) plus its private extensions (_harness/...);
// see sync-brand.mjs. Creds, per workspace, in .env:
//   <WS>_R2_ACCOUNT_ID  <WS>_R2_ACCESS_KEY_ID  <WS>_R2_SECRET_ACCESS_KEY  <WS>_R2_BUCKET
//
// Exports the low-level signers (signRequest, presignUrl) so they can be checked against the
// published AWS SigV4 test vectors (see selftest()), plus createR2() for real calls.
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sha256hex = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (key, d) => createHmac('sha256', key).update(d).digest();
const hmacHex = (key, d) => createHmac('sha256', key).update(d).digest('hex');
export const EMPTY_SHA256 = sha256hex('');

// RFC-3986 encoding (AWS-style): encodeURIComponent + the four extra chars it leaves alone.
const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p) => p.split('/').map(enc).join('/');
const unxml = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function signingKey(secret, dateStamp, region, service) {
  const kDate = hmac('AWS4' + secret, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

const amzNow = (d = new Date()) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

// Header-auth SigV4. headers must include host (and any x-amz-* you want signed). Returns the
// Authorization header value + the signature. payloadHash = hex sha256 of the body (or UNSIGNED-PAYLOAD).
export function signRequest({ method, path, query = '', headers, payloadHash, region, service, accessKeyId, secretAccessKey, amzDate }) {
  const dateStamp = amzDate.slice(0, 8);
  const lower = {};
  for (const k of Object.keys(headers)) lower[k.toLowerCase()] = String(headers[k]).trim();
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}`).join('\n') + '\n';
  const signedHeaders = names.join(';');
  const canonicalRequest = [method, encPath(path), query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp, region, service), stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signature, signedHeaders };
}

// Query-auth SigV4 (presigned URL). Returns a full https URL that anyone can GET until it expires.
export function presignUrl({ method = 'GET', host, path, expires = 3600, region, service = 's3', accessKeyId, secretAccessKey, amzDate = amzNow() }) {
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const canonicalRequest = [method, encPath(path), canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp, region, service), stringToSign);
  return `https://${host}${encPath(path)}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// A thin R2 client. region is "auto" for R2; the S3 endpoint is <accountId>.r2.cloudflarestorage.com.
export function createR2({ accountId, accessKeyId, secretAccessKey, bucket, region = 'auto', service = 's3' }) {
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new Error('createR2: missing accountId/accessKeyId/secretAccessKey/bucket');
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const keyPath = (key) => `/${bucket}/${key.replace(/^\/+/, '')}`;

  async function send(method, key, { body, contentType, query = '' } = {}) {
    const path = keyPath(key);
    const buf = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const payloadHash = sha256hex(buf);
    const amzDate = amzNow();
    const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    if (contentType) headers['content-type'] = contentType;
    const { authorization } = signRequest({ method, path, query, headers, payloadHash, region, service, accessKeyId, secretAccessKey, amzDate });
    const url = `https://${host}${encPath(path)}${query ? '?' + query : ''}`;
    const res = await fetch(url, { method, headers: { ...headers, Authorization: authorization }, body: method === 'GET' || method === 'HEAD' ? undefined : buf });
    return res;
  }

  return {
    host, bucket,
    async put(key, body, contentType) {
      // R2 occasionally returns transient 5xx ("InternalError ... Please try again") — retry with backoff.
      for (let attempt = 1; ; attempt++) {
        const res = await send('PUT', key, { body, contentType });
        if (res.ok) return true;
        const msg = `R2 put ${key} -> HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
        if (res.status < 500 || attempt >= 4) throw new Error(msg);
        await new Promise((r) => setTimeout(r, attempt * 1500));
      }
    },
    async putFile(key, filePath, contentType) {
      return this.put(key, await readFile(filePath), contentType);
    },
    async get(key) {
      const res = await send('GET', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 get ${key} -> HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async head(key) {
      const res = await send('HEAD', key);
      return res.ok ? { size: Number(res.headers.get('content-length') || 0) } : null;
    },
    async delete(key) {
      const res = await send('DELETE', key);
      if (!res.ok && res.status !== 404) throw new Error(`R2 delete ${key} -> HTTP ${res.status}`);
      return true;
    },
    // Every object under a prefix, with metadata: [{ key, etag, size, lastModified }]. etag is the
    // object's md5 hex for single-part PUTs (what put/putFile do); multipart etags contain '-'.
    async listWithMeta(prefix = '') {
      const out = [];
      let token;
      do {
        const params = new URLSearchParams({ 'list-type': '2', prefix });
        if (token) params.set('continuation-token', token);
        // canonical query must be sorted + RFC3986-encoded; URLSearchParams gives us a usable form for R2.
        const query = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
        const res = await send('GET', '', { query });
        if (!res.ok) throw new Error(`R2 list -> HTTP ${res.status}`);
        const xml = await res.text();
        for (const c of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const field = (tag) => { const m = c[1].match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? unxml(m[1]) : ''; };
          const key = field('Key');
          if (key) out.push({ key, etag: field('ETag').replace(/"/g, ''), size: +field('Size') || 0, lastModified: field('LastModified') });
        }
        const t = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
        token = t ? t[1] : null;
      } while (token);
      return out;
    },
    presignGet(key, expires = 3600) {
      return presignUrl({ host, path: keyPath(key), expires, region, service, accessKeyId, secretAccessKey });
    },
  };
}

// R2 creds for a workspace from a parsed .env object (returns null if not configured).
export function r2FromEnv(env, workspace) {
  const W = workspace.toUpperCase();
  const accountId = env[`${W}_R2_ACCOUNT_ID`];
  const accessKeyId = env[`${W}_R2_ACCESS_KEY_ID`];
  const secretAccessKey = env[`${W}_R2_SECRET_ACCESS_KEY`];
  const bucket = env[`${W}_R2_BUCKET`];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return createR2({ accountId, accessKeyId, secretAccessKey, bucket });
}

// Verify the signing against the two published AWS SigV4 examples. Run: node tools/lib/r2.mjs --selftest
function selftest() {
  const accessKeyId = 'AKIAIOSFODNN7EXAMPLE';
  const secretAccessKey = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
  const host = 'examplebucket.s3.amazonaws.com';
  // 1) GET Object (header auth) — AWS docs example.
  const h = signRequest({
    method: 'GET', path: '/test.txt', query: '',
    headers: { host, range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
    payloadHash: EMPTY_SHA256, region: 'us-east-1', service: 's3', accessKeyId, secretAccessKey, amzDate: '20130524T000000Z',
  });
  const want1 = 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41';
  // 2) Presigned GET — AWS docs example.
  const url = presignUrl({ method: 'GET', host, path: '/test.txt', expires: 86400, region: 'us-east-1', service: 's3', accessKeyId, secretAccessKey, amzDate: '20130524T000000Z' });
  const got2 = new URL(url).searchParams.get('X-Amz-Signature');
  const want2 = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
  const ok1 = h.signature === want1, ok2 = got2 === want2;
  console.log(`header-auth signature: ${ok1 ? 'PASS' : 'FAIL'}${ok1 ? '' : `\n  got  ${h.signature}\n  want ${want1}`}`);
  console.log(`presign signature:     ${ok2 ? 'PASS' : 'FAIL'}${ok2 ? '' : `\n  got  ${got2}\n  want ${want2}`}`);
  process.exit(ok1 && ok2 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--selftest')) selftest();
