// The floor PIN (src/auth.js, 2026-10-29): what a floor PIN is, the PINs the platform makes up, the floor's own
// session window, and the counts that stand in for the per-address limit at a plant. No database, no server.
//   node scripts/test-floorpin.js
process.env.SOS_FLOOR_DEVICE_FAILS = "3";
process.env.SOS_FLOOR_COMPANY_FAILS = "7";
const auth = require("../src/auth");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } };

t("a floor PIN is 6 to 8 digits", ["482913", "4829137", "48291375"].every(auth.validFloorPin));
t("five digits, nine digits, letters, spaces and nothing are not", !["48291", "482913750", "48a913", "482 913", "", null, undefined].some(auth.validFloorPin));
t("runs and repeats are what a person guesses first", ["123456", "654321", "111111", "121212", "000000", "98765432", "112112"].every(auth.guessable));
t("an ordinary PIN is not", !["482913", "593021", "70412", "13579246"].some(auth.guessable));
const made = Array.from({ length: 3000 }, auth.generateFloorPin);
t("a made-up floor PIN is 6 digits and never a guessable one", made.every((p) => /^\d{6}$/.test(p) && !auth.guessable(p)), made.find((p) => !/^\d{6}$/.test(p) || auth.guessable(p)));
t("and they are spread out (3000 made, nearly all different)", new Set(made).size > 2950, new Set(made).size);
t("a made-up floor PIN passes its own check", made.every(auth.validFloorPin));

t("the floor's window is a week idle and a month at most", auth.windowFor("floor").idle === 168 && auth.windowFor("floor").cap === 720, auth.windowFor("floor"));
t("a manager's is untouched (30 days idle, 180 at most)", auth.windowFor("manager").idle === 720 && auth.windowFor("manager").cap === 4320, auth.windowFor("manager"));
t("an admin's is untouched (7 days idle, 30 at most)", auth.windowFor("admin").idle === 168 && auth.windowFor("admin").cap === 720);
const now = Date.UTC(2026, 9, 29, 12);
t("a floor session used six days ago is still good", auth.alive("floor", now - 20 * 86400e3, now - 6 * 86400e3, now));
t("one left eight days is not", !auth.alive("floor", now - 8 * 86400e3, now - 8 * 86400e3, now));
t("a manager's left eight days still is", auth.alive("manager", now - 8 * 86400e3, now - 8 * 86400e3, now));
t("a floor session is never kept past a month, used or not", !auth.alive("floor", now - 31 * 86400e3, now - 3600e3, now));
t("the floor's cookie lives a week", auth.maxAgeFor("floor", now, now) === 7 * 86400);

auth._resetPlantCounts();
t("a device with no wrong tries waits for nothing", auth.plantWait("dev-a", "acme", now) === null);
for (let i = 0; i < 2; i++) auth.notePlantFail("dev-a", "acme", now + i);
t("two wrong tries on a device (of three): no wait yet", auth.plantWait("dev-a", "acme", now + 5) === null);
auth.notePlantFail("dev-a", "acme", now + 10);
const w = auth.plantWait("dev-a", "acme", now + 20);
t("the third makes that device wait five minutes", w && w.who === "device" && w.wait > 290 && w.wait <= 300, w);
t("another device at the same plant is not held", auth.plantWait("dev-b", "acme", now + 20) === null);
t("after the five minutes the device may try again", auth.plantWait("dev-a", "acme", now + 10 + 5 * 60e3 + 1) === null);
for (const d of ["dev-c", "dev-d", "dev-e", "dev-f"]) auth.notePlantFail(d, "acme", now + 30);
const p = auth.plantWait("dev-z", "acme", now + 40);
t("seven wrong tries across the plant in the window pause the plant, even for a device with none", p && p.who === "plant" && p.wait > 0, p);
t("another plant is not paused", auth.plantWait("dev-z", "other", now + 40) === null);
t("the pause ends with the window", auth.plantWait("dev-z", "acme", now + 15 * 60e3 + 1) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
