// clean-image.mjs — strip metadata (C2PA, EXIF, XMP, text chunks) from PNG/JPEG without touching
// pixels; other formats pass through. generate-image.mjs runs every saved file through it.
// Usage: node tools/lib/clean-image.mjs <file> [file …]
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Ancillary PNG chunks that carry metadata only (caBX = C2PA manifest).
const PNG_DROP = new Set(['caBX', 'tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME']);

function cleanPng(buf) {
  const out = [buf.subarray(0, 8)];
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (!PNG_DROP.has(type)) out.push(buf.subarray(i, end));
    i = end;
  }
  return Buffer.concat(out);
}

// JPEG: drop APP1 (EXIF/XMP), APP11 (JUMBF/C2PA), APP13 (IPTC) and comments before the scan.
function cleanJpeg(buf) {
  const out = [buf.subarray(0, 2)];
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    if (marker === 0xda) { out.push(buf.subarray(i)); return Buffer.concat(out); } // start of scan: rest is image data
    const len = buf.readUInt16BE(i + 2);
    const drop = marker === 0xe1 || marker === 0xeb || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(buf.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return buf; // unexpected layout: leave untouched rather than risk a broken file
}

export function cleanImage(buf) {
  if (buf.subarray(0, 8).equals(PNG_SIG)) return cleanPng(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return cleanJpeg(buf);
  return buf;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('Usage: node tools/lib/clean-image.mjs <file> [file …]'); process.exit(1); }
  for (const f of files) {
    const before = readFileSync(f);
    const after = cleanImage(before);
    writeFileSync(f, after);
    console.log(`${f}: ${before.length - after.length} bytes of metadata removed`);
  }
}
