// Time-based one-time codes (RFC 6238 over RFC 4226), for the authenticator app
// an admin enrolls on /admin. node:crypto only.
//
//   HMAC-SHA1, 30 second step, 6 digits: what Google Authenticator, 1Password
//   and Authy all assume when the otpauth:// URI says nothing else.
//   A code is accepted for the step before, the current step and the step
//   after (a phone clock a little off, a code typed as it rolls over).
//   check() answers WHICH step matched, because the caller must claim that
//   step so the same code never works twice (src/accounts.js, last_step).
//
// node src/totp.js runs the RFC 6238 test vectors and the window cases.
const crypto = require("crypto");

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;   // steps either side of now
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// ---- base32 (RFC 4648, no padding on the way out; padding, spaces, dashes and lower case forgiven on the way in)
function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ---- the code for one step ------------------------------------------------------------------------
function stepAt(ms = Date.now()) { return Math.floor(ms / 1000 / STEP_SECONDS); }
function hotp(secret, counter, digits = DIGITS) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}
function codeAt(secret, ms = Date.now()) { return hotp(secret, stepAt(ms)); }

// -> the step that matched, or null. Every candidate is compared, in constant time, whether or not an earlier
// one matched, so the answer's timing says nothing about which step (or how much of the code) was right.
function check(secret, code, ms = Date.now()) {
  const typed = String(code == null ? "" : code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(typed)) return null;
  const got = Buffer.from(typed), now = stepAt(ms);
  let matched = null;
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const want = Buffer.from(hotp(secret, now + d));
    if (crypto.timingSafeEqual(got, want) && matched === null) matched = now + d;
  }
  return matched;
}

// 20 random bytes: the HMAC-SHA1 block the RFC recommends, 32 base32 characters to type if the QR will not scan
function newSecret() { return crypto.randomBytes(20); }
// What the QR code carries. The label and the issuer are both shown by the authenticator app.
function uri(secret, login, issuer = "Anetix SOS") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(login)}?secret=${base32Encode(secret)}&issuer=${encodeURIComponent(issuer)}`;
}

module.exports = { base32Encode, base32Decode, hotp, codeAt, check, stepAt, newSecret, uri, STEP_SECONDS, DIGITS, WINDOW };

// ---- self test: node src/totp.js ---------------------------------------------------------------------
if (require.main === module) {
  let pass = 0, fail = 0;
  const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail ? "\n      " + detail : ""}`); } };
  // RFC 6238 appendix B, the SHA1 rows: 8 digit codes for the ASCII secret "12345678901234567890"
  const rfc = Buffer.from("12345678901234567890");
  for (const [sec, want] of [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]]) {
    const got = hotp(rfc, Math.floor(sec / 30), 8);
    t(`RFC 6238 vector at ${sec}s`, got === want, `${got} != ${want}`);
    t(`six digits are the last six of the eight at ${sec}s`, hotp(rfc, Math.floor(sec / 30), 6) === want.slice(2));
  }
  // RFC 4226 appendix D: the first three HOTP values
  t("RFC 4226 counters 0, 1, 2", hotp(rfc, 0) === "755224" && hotp(rfc, 1) === "287082" && hotp(rfc, 2) === "359152");
  // base32
  t("base32 of the RFC secret", base32Encode(rfc) === "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  t("base32 round trip, 20 random bytes", (() => { const s = newSecret(); return base32Decode(base32Encode(s)).equals(s); })());
  t("base32 forgives lower case, spaces, dashes and padding", base32Decode("gezd gnbv-gy3t qojq====").equals(Buffer.from("1234567890")));
  t("base32 refuses what is not base32", (() => { try { base32Decode("01!"); return false; } catch (e) { return true; } })());
  // the window (a fixed secret and a fixed time, so the cases are the same on every run)
  const s = Buffer.from("anetix-sos-unit-test"), now = 1790000000000, st = stepAt(now);
  const near = [st - 1, st, st + 1].map((k) => hotp(s, k));
  t("the current code passes and names its step", check(s, hotp(s, st), now) === st);
  t("the step before passes", check(s, hotp(s, st - 1), now) === st - 1);
  t("the step after passes", check(s, hotp(s, st + 1), now) === st + 1);
  t("the fixture has no colliding codes", new Set([...near, hotp(s, st - 2), hotp(s, st + 2)]).size === 5);
  t("two steps back fails", check(s, hotp(s, st - 2), now) === null);
  t("two steps ahead fails", check(s, hotp(s, st + 2), now) === null);
  t("a code with a space in it is read", check(s, `${near[1].slice(0, 3)} ${near[1].slice(3)}`, now) === st);
  t("junk is refused, not a crash", [null, undefined, "", "12345", "1234567", "abcdef", "12345a", {}, 12].every((x) => check(s, x, now) === null));
  t("another secret's code fails", check(Buffer.from("some-other-secret-xx"), near[1], now) === null);
  const u = uri(rfc, "brf1998@gmail.com");
  t("the otpauth uri", u === "otpauth://totp/Anetix%20SOS:brf1998%40gmail.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Anetix%20SOS", u);
  t("the uri fits the platform's QR generator (216 bytes, byte mode)", Buffer.byteLength(uri(rfc, "taylor.pearlman@gmail.com")) <= 216);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
