// Bangun extension Chrome dari userscript (satu sumber kode: auto-log-ipb.user.js).
//   node tools/build-extension.mjs
// Hasil: dist/extension/ (untuk "Load unpacked") dan dist/logmager-extension-<versi>.zip (untuk Chrome Web Store).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "auto-log-ipb.user.js"), "utf8");
const version = src.match(/@version\s+([\d.]+)/)?.[1];
if (!version) throw new Error("@version tidak ditemukan di userscript");

const out = path.join(root, "dist", "extension");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "icons"), { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension", "manifest.json"), "utf8"));
manifest.version = version; // versi selalu ikut userscript
const files = {
  "manifest.json": JSON.stringify(manifest, null, 2) + "\n",
  // Header ==UserScript== tidak dibutuhkan di extension.
  "content.js": src.replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, ""),
};
for (const f of fs.readdirSync(path.join(root, "extension", "icons"))) {
  files[`icons/${f}`] = fs.readFileSync(path.join(root, "extension", "icons", f));
}
for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(out, name), data);

// ZIP sederhana (deflate) tanpa library luar.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const locals = [], central = [];
let offset = 0;
const now = new Date(); // tanggal file di ZIP (format DOS)
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
for (const [name, data] of Object.entries(files)) {
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const comp = zlib.deflateRawSync(raw);
  const nameBuf = Buffer.from(name);
  const crc = crc32(raw);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
  lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
  locals.push(lh, nameBuf, comp);
  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
  ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14);
  ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
  ch.writeUInt32LE(offset, 42);
  central.push(ch, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const cdSize = central.reduce((a, b) => a + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
const zipPath = path.join(root, "dist", `logmager-extension-${version}.zip`);
fs.writeFileSync(zipPath, Buffer.concat([...locals, ...central, end]));
console.log(`Extension v${version}: dist/extension/ dan ${path.relative(root, zipPath)}`);
