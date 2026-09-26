// Unit checks for src/passkeys.js: the site name a passkey is made for, the addresses an answer may come from, labels.
const p = require("../src/passkeys");
let pass = 0, fail = 0;
const t = (name, ok, detail) => { if (ok) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail) : ""}`); } };
t("the product at app.anetix.ai with the wall at anetix.ai: one name, anetix.ai, for both", p.rpIdFor("app.anetix.ai", "anetix.ai") === "anetix.ai");
t("the wall's www. does not change it", p.rpIdFor("app.anetix.ai", "www.anetix.ai") === "anetix.ai");
t("a product with no wall of its own keeps its own host", p.rpIdFor("sos.finnoperations.com", "anetix.ai") === "sos.finnoperations.com");
t("SOS_PASSKEY_RP_ID wins", p.rpIdFor("app.anetix.ai", "anetix.ai", "Anetix.ai") === "anetix.ai");
t("localhost for tests", p.rpIdFor("localhost", "localhost") === "localhost");
const o = p.originsFor({ rp: "anetix.ai", host: "app.anetix.ai", proto: "https", www: "https://anetix.ai" });
t("answers may come from the wall and the product, over https", o.includes("https://anetix.ai") && o.includes("https://app.anetix.ai") && o.includes("https://www.anetix.ai") && o.every((x) => x.startsWith("https://")), o);
t("never from another site", !p.originsFor({ rp: "anetix.ai", host: "evil.com", proto: "https", www: "https://evil.com" }).some((x) => /evil/.test(x)));
t("plain http only for localhost", p.originsFor({ rp: "localhost", host: "localhost", proto: "http" }).includes("http://localhost") && !p.originsFor({ rp: "anetix.ai", host: "app.anetix.ai", proto: "http" }).some((x) => x.startsWith("http:")));
t("labels name the device and the browser", p.labelFrom("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1") === "iPhone, Safari"
  && p.labelFrom("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36") === "Mac, Chrome"
  && p.labelFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0") === "Windows, Edge"
  && p.labelFrom("") === "a device");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
