// Packs dist-itch/ into cardcraft-castles-itch.zip, with index.html at the
// root of the archive as itch.io asks. Plain Node (zlib), no zip tool needed.
import { crc32, deflateRawSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = join(root, 'dist-itch');
const out = join(root, 'cardcraft-castles-itch.zip');

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(path, e.name)) : [join(path, e.name)],
  );
}

// Already compressed: stored as they are.
const STORED = /\.(webp|png|jpe?g|mp3|ogg|m4a|woff2?)$/i;
const files = walk(dir).sort();
const local = [];
const central = [];
let offset = 0;
for (const path of files) {
  const name = Buffer.from(relative(dir, path).split(sep).join('/'));
  const data = readFileSync(path);
  const store = STORED.test(path);
  const body = store ? data : deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(0x0800, 6); // UTF-8 names
  head.writeUInt16LE(store ? 0 : 8, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(0x21, 12); // 1980-01-01
  head.writeUInt32LE(crc, 14);
  head.writeUInt32LE(body.length, 18);
  head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28);
  local.push(head, name, body);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(store ? 0 : 8, 10);
  entry.writeUInt16LE(0, 12);
  entry.writeUInt16LE(0x21, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(body.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += head.length + name.length + body.length;
}
const centralSize = central.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);
writeFileSync(out, Buffer.concat([...local, ...central, end]));

const mb = (statSync(out).size / 1024 / 1024).toFixed(1);
console.log(`itch: ${files.length} files, ${mb} MB -> ${relative(process.cwd(), out)}`);
// itch.io limits for HTML5 uploads: 1000 files, 200 MB per file, 500 MB unpacked.
if (files.length > 1000) console.warn('itch: more than 1000 files, itch.io will refuse the upload');
