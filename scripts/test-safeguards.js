// Unit cases for src/safeguards.js: the network list a company's shared sign-ins work from. No database, no network.
//   node scripts/test-safeguards.js
const sg = require("../src/safeguards");
let pass = 0, fail = 0;
function t(name, cond, detail) { if (cond) { pass++; } else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } }
const throws = (fn, re) => { try { fn(); return false; } catch (e) { return e.status === 400 && (!re || re.test(e.message)); } };

// ---- one entry
t("an address alone is that one address", sg.cleanNetwork("203.0.113.7") === "203.0.113.7/32" && sg.cleanNetwork(" 2001:DB8::1 ") === "2001:db8::1/128");
t("a range is kept as typed, lower case", sg.cleanNetwork("203.0.113.0/24") === "203.0.113.0/24" && sg.cleanNetwork("2001:DB8:AB::/48") === "2001:db8:ab::/48");
t("what is not an address is refused in words a person can act on", throws(() => sg.cleanNetwork("plant-wifi"), /not an address/) && throws(() => sg.cleanNetwork("203.0.113"), /not an address/) && throws(() => sg.cleanNetwork("203.0.113.7/24/2"), /not an address/) && throws(() => sg.cleanNetwork(""), /not an address/));
t("a range size that is not one is refused", throws(() => sg.cleanNetwork("203.0.113.0/33"), /up to 32/) && throws(() => sg.cleanNetwork("203.0.113.0/x"), /range size/) && throws(() => sg.cleanNetwork("2001:db8::/129"), /up to 128/));
t("a range too wide to be one plant is refused, and says how to mean anywhere", throws(() => sg.cleanNetwork("0.0.0.0/0"), /clear the list/) && throws(() => sg.cleanNetwork("10.0.0.0/7"), /too wide/) && throws(() => sg.cleanNetwork("::/0"), /too wide/) && sg.cleanNetwork("10.0.0.0/8") === "10.0.0.0/8");

// ---- a list
t("a list as typed: lines, commas and spaces, no repeats, blanks dropped", JSON.stringify(sg.cleanNetworks("203.0.113.7\n198.51.100.0/24, 203.0.113.7\n\n  2001:db8::/64 ")) === JSON.stringify(["203.0.113.7/32", "198.51.100.0/24", "2001:db8::/64"]));
t("an array works the same, and nothing at all is the empty list (anywhere)", JSON.stringify(sg.cleanNetworks(["203.0.113.7", " "])) === JSON.stringify(["203.0.113.7/32"]) && sg.cleanNetworks("").length === 0 && sg.cleanNetworks(null).length === 0 && sg.cleanNetworks([]).length === 0);
t("one bad entry refuses the whole list", throws(() => sg.cleanNetworks("203.0.113.7\nnope"), /not an address/));
t(`more than ${sg.MAX_NETWORKS} entries is refused`, throws(() => sg.cleanNetworks(Array.from({ length: sg.MAX_NETWORKS + 1 }, (_x, i) => `203.0.113.${i}`)), /the most/) && sg.cleanNetworks(Array.from({ length: sg.MAX_NETWORKS }, (_x, i) => `203.0.113.${i}`)).length === sg.MAX_NETWORKS);

// ---- is an address on the list
const list = ["203.0.113.7/32", "198.51.100.0/24", "2001:db8:ab:cd::/64"];
t("the one address, and an address inside a range", sg.inNetworks(list, "203.0.113.7") && sg.inNetworks(list, "198.51.100.200") && sg.inNetworks(list, "2001:db8:ab:cd:1:2:3:4"));
t("next door is not", !sg.inNetworks(list, "203.0.113.8") && !sg.inNetworks(list, "198.51.101.1") && !sg.inNetworks(list, "2001:db8:ab:ce::1"));
t("a v4 address written as v6 is read as v4", sg.inNetworks(list, "::ffff:203.0.113.7") && !sg.inNetworks(list, "::ffff:203.0.113.8"));
t("junk, 'unknown' and no list are never on it", [null, undefined, "", "unknown", "203.0.113", {}].every((x) => sg.inNetworks(list, x) === false) && sg.inNetworks([], "203.0.113.7") === false && sg.inNetworks(null, "203.0.113.7") === false);

// ---- "the network I am on"
t("a v4 address is itself", sg.networkOf("203.0.113.7") === "203.0.113.7/32" && sg.networkOf("::ffff:203.0.113.7") === "203.0.113.7/32");
t("a v6 address is the /64 it sits in, however it was written", sg.networkOf("2001:db8:ab:cd:1:2:3:4") === "2001:db8:ab:cd::/64" && sg.networkOf("2001:0db8:00ab:00cd::1") === "2001:db8:ab:cd::/64" && sg.networkOf("2001:db8::1") === "2001:db8:0:0::/64");
t("and that /64 holds the address it came from", ["2001:db8:ab:cd:1:2:3:4", "2001:db8::1", "2600:1700:abcd:12:aaaa:bbbb:cccc:dddd"].every((a) => sg.inNetworks(sg.cleanNetworks([sg.networkOf(a)]), a)));
t("what is not an address has no network", sg.networkOf("unknown") === null && sg.networkOf("") === null && sg.networkOf(null) === null);

// ---- a list needs a proven address
t("a hosted instance takes a list only while the edge check is enforced; local work and the tests always may", sg.mayHoldToNetwork(true, true) === true && sg.mayHoldToNetwork(true, false) === false && sg.mayHoldToNetwork(false, false) === true && sg.mayHoldToNetwork(false, true) === true);

// ---- the platform's own calls and the defaults
t("with no company there is nothing to hold anyone to", sg.DEFAULTS.talk === true && sg.DEFAULTS.label_preview === true && sg.DEFAULTS.require_scan === false && sg.DEFAULTS.networks.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
