// r2.mjs — Cloudflare R2 client with AWS SigV4 signing, zero deps. One bucket per workspace.
// Self-test against AWS's published SigV4 examples: node tools/lib/r2.mjs --selftest
import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sha256hex = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (key, d) => createHmac('sha256', key).update(d).digest();
const hmacHex = (key, d) => createHmac('sha256', key).update(d).digest('hex');
export const EMPTY_SHA256 = sha256hex('');

// encodeURIComponent leaves !'()* alone; AWS wants them encoded.
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

// headers must include host. payloadHash = hex sha256 of the body (or UNSIGNED-PAYLOAD).
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

// A presigned URL anyone can GET until it expires.
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
      // R2 sometimes returns transient 5xx.
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
    // [{ key, etag, size, lastModified }]. etag = md5 hex for single-part PUTs; multipart etags contain '-'.
    async listWithMeta(prefix = '') {
      const out = [];
      let token;
      do {
        const params = new URLSearchParams({ 'list-type': '2', prefix });
        if (token) params.set('continuation-token', token);
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

// Reads <WS>_R2_ACCOUNT_ID, _ACCESS_KEY_ID, _SECRET_ACCESS_KEY, _BUCKET; null if not configured.
export function r2FromEnv(env, workspace) {
  const W = workspace.toUpperCase();
  const accountId = env[`${W}_R2_ACCOUNT_ID`];
  const accessKeyId = env[`${W}_R2_ACCESS_KEY_ID`];
  const secretAccessKey = env[`${W}_R2_SECRET_ACCESS_KEY`];
  const bucket = env[`${W}_R2_BUCKET`];
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return createR2({ accountId, accessKeyId, secretAccessKey, bucket });
}

// Workspaces whose bucket anyone can read, without keys (override with <WS>_R2_PUBLIC_URL).
export const PUBLIC_BUCKETS = { Shared: 'https://pub-c457777d46bc40dcaf37f000903f5a53.r2.dev' };
export const MANIFEST = '.manifest.json'; // per top-level prefix; a public bucket can't be listed

// Read-only client for a public bucket: lists from <prefix>/.manifest.json, which pushes write.
export function r2Public(env, workspace) {
  const base = (env[`${workspace.toUpperCase()}_R2_PUBLIC_URL`] || PUBLIC_BUCKETS[workspace] || '').replace(/\/+$/, '');
  if (!base) return null;
  const url = (key) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return {
    public: true,
    async get(key) {
      const res = await fetch(url(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`GET ${key} -> HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async listWithMeta(prefix = '') {
      const res = await fetch(url(`${prefix.split('/')[0]}/${MANIFEST}`));
      if (res.status === 404) return [];
      if (!res.ok) throw new Error(`manifest -> HTTP ${res.status}`);
      return (await res.json()).filter((o) => o.key.startsWith(prefix));
    },
    presignGet: (key) => url(key),
  };
}

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
