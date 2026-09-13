// Regenerates browser icons from assets/logo-{light,dark}.png with zero dependencies.
// Run via: make generate-assets (or: docker run --rm -v "$PWD":/app -w /app node:22-bookworm-slim node scripts/generate-assets.mjs)
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(file) {
  const png = readFileSync(file);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!png.subarray(0, 8).equals(sig)) throw new Error(`${file}: not a PNG`);
  let pos = 8;
  let w;
  let h;
  let idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`${file}: bit depth ${data[8]} != 8`);
      if (data[9] !== 6) throw new Error(`${file}: color type ${data[9]} != 6 (RGBA)`);
      if (data[12] !== 0) throw new Error(`${file}: interlaced PNG not supported`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!w || !h) throw new Error(`${file}: missing IHDR`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  if (raw.length !== (stride + 1) * h) throw new Error(`${file}: unexpected raw length`);
  const px = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ro = y * (stride + 1);
    const filter = raw[ro];
    const line = Buffer.from(raw.subarray(ro + 1, ro + 1 + stride));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let v;
      if (filter === 0) v = line[x];
      else if (filter === 1) v = (line[x] + a) & 0xff;
      else if (filter === 2) v = (line[x] + b) & 0xff;
      else if (filter === 3) v = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (line[x] + paeth(a, b, c)) & 0xff;
      else throw new Error(`${file}: unknown filter ${filter}`);
      out[x] = v;
    }
    prev.set(out);
  }
  return { w, h, px };
}

function stats({ w, h, px }) {
  let lum = 0;
  let cov = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (px[o + 3] === 0) continue;
    lum += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    cov++;
  }
  if (cov === 0) throw new Error('fully transparent image');
  return { avgLum: lum / cov, coverage: cov / (w * h) };
}

function resize({ w, h, px }, size) {
  const out = Buffer.alloc(size * size * 4);
  const sx = w / size;
  const sy = h / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy2 = y0; sy2 < y1 && sy2 < h; sy2++) {
        for (let sx2 = x0; sx2 < x1 && sx2 < w; sx2++) {
          const o = (sy2 * w + sx2) * 4;
          const av = px[o + 3] / 255;
          r += px[o] * av;
          g += px[o + 1] * av;
          b += px[o + 2] * av;
          a += px[o + 3];
          n++;
        }
      }
      const o = (y * size + x) * 4;
      const alpha = a / n;
      out[o + 3] = Math.round(alpha);
      if (alpha > 0) {
        out[o] = Math.round(r / n / (alpha / 255));
        out[o + 1] = Math.round(g / n / (alpha / 255));
        out[o + 2] = Math.round(b / n / (alpha / 255));
      }
    }
  }
  return out;
}

function encodePng(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const light = decodePng(join(root, 'assets/logo-light.png'));
const dark = decodePng(join(root, 'assets/logo-dark.png'));
const sl = stats(light);
const sd = stats(dark);
console.log(
  `logo-light.png: avg luminance of non-transparent pixels ${sl.avgLum.toFixed(1)}/255, non-transparent coverage ${(sl.coverage * 100).toFixed(1)}%`,
);
console.log(
  `logo-dark.png: avg luminance of non-transparent pixels ${sd.avgLum.toFixed(1)}/255, non-transparent coverage ${(sd.coverage * 100).toFixed(1)}%`,
);

// ponytail: logo-dark feeds all variants as stopgap — logo-light lineart has too much
// transparent margin at toolbar sizes; restore variant selection once tightened.
const darkThemeSource = dark;
const lightThemeSource = dark;
console.log('Decision: logo-dark.png forced for all variants (stopgap)');

mkdirSync(join(root, 'public/icons'), { recursive: true });
for (const size of SIZES) {
  writeFileSync(
    join(root, `public/icons/icon-${size}.png`),
    encodePng(size, resize(lightThemeSource, size)),
  );
  writeFileSync(
    join(root, `public/icons/icon-${size}-light.png`),
    encodePng(size, resize(lightThemeSource, size)),
  );
  writeFileSync(
    join(root, `public/icons/icon-${size}-dark.png`),
    encodePng(size, resize(darkThemeSource, size)),
  );
  console.log(`icon-${size}.png, icon-${size}-light.png, icon-${size}-dark.png`);
}
