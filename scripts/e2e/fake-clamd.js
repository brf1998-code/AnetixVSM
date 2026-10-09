// A stand-in for the upload scanner (clamd), for the tests of src/scan.js. It speaks the part of clamd's protocol the
// product uses, on a TCP port: zVERSION, zPING and zINSTREAM (the file as chunks, each led by its length in four
// bytes, ended by a chunk of length zero). A file is "flagged" when its bytes carry one of the marks, which the test
// may change while it runs (how a file that was clean by last week's signatures is flagged by today's); a file
// carrying one of fake.wontTake gets clamd's per-file ERROR instead of a verdict.
//   const fake = await require("./fake-clamd").start(4666);   fake.marks, fake.down, fake.signaturesAt, fake.scans, fake.stop()
const net = require("net");

// The industry's harmless test file, put together here so the string itself sits in no file of this repo (a scanner
// reading the repo would flag it). A real clamd flags it; this stand-in flags it too.
const EICAR = ["X5O!P%@AP[4\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE", "!$H+H*"].join("");
const MARK = "SOS-TEST-MALWARE-MARK";

function start(port, { limit = 25 * 1024 * 1024 } = {}) {
  const fake = { marks: [MARK, EICAR], wontTake: [], down: false, signaturesAt: new Date(), signatures: 27784, engine: "1.4.3", scans: 0, versions: 0, last: null, sockets: new Set() };
  const stamp = (d) => d.toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, (_m, wd, day, mon, yr, tm) => `${wd} ${mon} ${day.padStart(2, " ")} ${tm} ${yr}`);
  const server = net.createServer((sock) => {
    fake.sockets.add(sock); sock.on("close", () => fake.sockets.delete(sock)); sock.on("error", () => {});
    if (fake.down) return sock.destroy();
    let buf = Buffer.alloc(0), command = null, body = [], size = 0;
    const answer = (line) => { try { sock.end(`${line}\0`); } catch (e) {} };
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (command === null) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        command = buf.subarray(0, end).toString("utf8"); buf = buf.subarray(end + 1);
        if (command === "zPING") return answer("PONG");
        if (command === "zVERSION") { fake.versions++; return answer(`ClamAV ${fake.engine}/${fake.signatures}/${stamp(fake.signaturesAt)}`); }
        if (command !== "zINSTREAM") return answer("UNKNOWN COMMAND");
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          const whole = Buffer.concat(body);
          fake.scans++; fake.last = { bytes: whole.length };
          // a file the scanner gives up on: clamd answers an ERROR for that one file and goes on serving
          if (fake.wontTake.some((m) => whole.includes(m))) return answer("stream: Can't allocate memory ERROR");
          const hit = fake.marks.find((m) => whole.includes(m));
          return answer(hit ? `stream: ${hit === EICAR ? "Eicar-Signature" : "Test.Mark-1"} FOUND` : "stream: OK");
        }
        if (buf.length < 4 + len) return;
        size += len;
        if (size > limit) return answer("INSTREAM size limit exceeded. ERROR");
        body.push(buf.subarray(4, 4 + len)); buf = buf.subarray(4 + len);
      }
    });
  });
  fake.stop = () => new Promise((r) => { for (const s of fake.sockets) s.destroy(); server.close(() => r()); });
  return new Promise((resolve, reject) => { server.on("error", reject); server.listen(port, "127.0.0.1", () => resolve(fake)); });
}

module.exports = { start, EICAR, MARK };
