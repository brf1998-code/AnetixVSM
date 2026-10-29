// A company's plain mark (2026-10-29): what a tab and a phone's home screen show for a company that has no icon of
// its own, instead of the Anetix mark. Brendan, from Chelsea Clock's request #290: "every chelsea tool window the
// anetix logo pops up on the tab header, it should be more discreetly anetix". The mark is the company's initials on
// its own color (the brand guide's primary, else a plain navy), as an SVG for the tab and a PNG for iOS, which takes
// nothing else for a home screen icon. No dependency: the PNG is drawn here with a 5 by 7 letter grid and node's zlib.
const zlib = require("zlib");

const DEFAULT_COLOR = "#1f3a5f";
// 5 by 7 letters and digits, one string a row
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"], D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"], H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"], J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"], R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"], V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"], X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"], Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], 1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], 3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], 5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"], 7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], 9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

// "Chelsea Clock" -> "CC", "Pearlman LLC" -> "PL", "Gemba" -> "G". Letters and digits only, at most two.
function initialsOf(name, fallback = "") {
  const words = String(name || "").normalize("NFKD").replace(/[^A-Za-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = words.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("");
  return out || String(fallback || "").replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase() || "?";
}
// A color as #rrggbb, or the default. Only a plain hex color is ever written into the SVG.
function cleanColor(c) {
  const s = String(c || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) return ("#" + s.slice(1).split("").map((x) => x + x).join("")).toLowerCase();
  return DEFAULT_COLOR;
}
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
// white letters on a dark color, near-black on a light one
function inkFor(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#14171c" : "#ffffff";
}

function markSvg(name, color, fallback) {
  const bg = cleanColor(color), ink = inkFor(bg), text = initialsOf(name, fallback).replace(/[^A-Z0-9?]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/>`
    + `<text x="32" y="33" dominant-baseline="central" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',Arial,sans-serif" font-weight="700" font-size="${text.length > 1 ? 27 : 34}" fill="${ink}">${text}</text></svg>`;
}

// ---- the PNG ---------------------------------------------------------------------------------------------------------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function markPng(name, color, fallback, size = 180) {
  size = Math.max(16, Math.min(512, Math.round(size)));
  const bg = rgbOf(cleanColor(color)), ink = rgbOf(inkFor(cleanColor(color)));
  const text = initialsOf(name, fallback).split("").filter((ch) => GLYPHS[ch]);
  // the letters: 5 cells wide each, one cell between, 7 tall; as large as fits half the square
  const cols = text.length ? text.length * 5 + (text.length - 1) : 0;
  const cell = text.length ? Math.max(1, Math.floor(Math.min((size * 0.56) / cols, (size * 0.5) / 7))) : 0;
  const x0 = Math.round((size - cols * cell) / 2), y0 = Math.round((size - 7 * cell) / 2);
  const radius = size * 0.22;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;   // no filter
    for (let x = 0; x < size; x++) {
      // rounded corners: outside the corner circles is clear
      const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x;
      const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y;
      const out = (x - cx) ** 2 + (y - cy) ** 2 > radius * radius;
      let on = false;
      if (cell && x >= x0 && y >= y0 && y < y0 + 7 * cell) {
        const gx = Math.floor((x - x0) / cell), gy = Math.floor((y - y0) / cell), letter = Math.floor(gx / 6), within = gx % 6;
        if (letter < text.length && within < 5) on = GLYPHS[text[letter]][gy][within] === "1";
      }
      const c = on ? ink : bg, at = row + 1 + x * 4;
      raw[at] = c[0]; raw[at + 1] = c[1]; raw[at + 2] = c[2]; raw[at + 3] = out ? 0 : 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// ---- an icon a manager uploads ---------------------------------------------------------------------------------------
// A PNG or a JPEG, by its first bytes (never by what the browser says it is), at most MAX_UPLOAD. Never an SVG: an SVG
// can carry script, and the icon is served from this site. -> { type, bytes } or throws with words.
const MAX_UPLOAD = 512 * 1024;
function readUpload(dataUrl) {
  const m = /^data:image\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!m) throw Object.assign(new Error("send the picture as a PNG or JPEG file"), { status: 400 });
  const bytes = Buffer.from(m[1].replace(/\s/g, ""), "base64");
  if (!bytes.length) throw Object.assign(new Error("that file is empty"), { status: 400 });
  if (bytes.length > MAX_UPLOAD) throw Object.assign(new Error(`that picture is ${Math.round(bytes.length / 1024)} KB; the most is ${MAX_UPLOAD / 1024} KB. A square logo around 256 by 256 is plenty.`), { status: 400 });
  const png = bytes.length > 8 && bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw Object.assign(new Error("that is not a PNG or JPEG picture (an SVG or a screenshot of a PDF will not do: save the logo as a PNG)"), { status: 400 });
  return { type: png ? "image/png" : "image/jpeg", bytes };
}

module.exports = { initialsOf, cleanColor, inkFor, markSvg, markPng, readUpload, crc32, MAX_UPLOAD, DEFAULT_COLOR, GLYPHS };
