// Unit cases for the pure parts of option C (src/dbroles.js and src/runner.js): the role names and grants, what
// the child is told about a visitor and what is stripped, the permission-flag shape. No database, no fork:
//   node scripts/test-runner.js
process.env.SESSION_SECRET = "unit-secret";
const dbroles = require("../src/dbroles");
const runner = require("../src/runner");
let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); } };

// ---- role names and passwords
t("a company has a live role and a staging role, named for it", dbroles.roleName("demo", "live") === "sos_demo_live" && dbroles.roleName("demo", "staged") === "sos_demo_stg");
t("a dashed slug is made a safe identifier", dbroles.roleName("acme-two", "live") === "sos_acme_two_live");
t("the two lanes have different passwords, and neither is the raw secret", dbroles.passwordFor("sos_demo_live") !== dbroles.passwordFor("sos_demo_stg") && !dbroles.passwordFor("sos_demo_live").includes("unit-secret"));
t("a password is url-safe (it goes into a connection string and a SQL literal)", /^[A-Za-z0-9_-]+$/.test(dbroles.passwordFor("sos_demo_live")));
t("the same role always derives the same password", dbroles.passwordFor("sos_x_live") === dbroles.passwordFor("sos_x_live"));
const conn = dbroles.connectionFor("demo", "live", "postgres://sos:sos@db.internal:5433/appdb");
t("a connection keeps the host, port and database and swaps in the role", conn.host === "db.internal" && conn.port === 5433 && conn.database === "appdb" && conn.user === "sos_demo_live" && conn.password === dbroles.passwordFor("sos_demo_live"));
t("Railway gets ssl, localhost does not", Boolean(dbroles.connectionFor("demo", "live", "postgres://u:p@x.rlwy.net:1/d").ssl) && !dbroles.connectionFor("demo", "live", "postgres://u:p@127.0.0.1:5432/d").ssl);

// ---- grants
const g = (has) => dbroles.grantStatements("demo", "paperline", has).join("\n");
{
  const all = g({ live: true, staged: true, liveMigrations: true, stagedMigrations: true });
  t("the live role reads and writes its live tables", /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mod_demo_paperline TO sos_demo_live/.test(all));
  t("the staging role only READS the live tables", /GRANT SELECT ON ALL TABLES IN SCHEMA mod_demo_paperline TO sos_demo_stg/.test(all) && !/INSERT[^\n]*mod_demo_paperline TO sos_demo_stg/.test(all));
  t("the staging role reads and writes the staging tables", /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA stg_demo_paperline TO sos_demo_stg/.test(all));
  t("the live role is never granted anything on the staging schema", !/stg_demo_paperline TO sos_demo_live/.test(all));
  t("neither role touches the migration bookkeeping table", /REVOKE ALL ON mod_demo_paperline._migrations FROM sos_demo_live, sos_demo_stg/.test(all) && /REVOKE ALL ON stg_demo_paperline._migrations FROM sos_demo_stg/.test(all));
  t("the live role may use its own sequences (serial ids)", /GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA mod_demo_paperline TO sos_demo_live/.test(all));
}
t("no staging schema yet: nothing is granted on it", !/stg_demo_paperline/.test(g({ live: true, staged: false, liveMigrations: true })));
t("nothing exists yet: no statements at all", dbroles.grantStatements("demo", "paperline", {}).length === 0);

// ---- what the child is told about a visitor, and what is stripped
{
  const h = runner.identityHeaders({ sosRole: "manager", sosPerson: "María G", sosPersonId: 7, sosPersonRole: "lead" }, "abc123def456abc123def456");
  t("the role, the person (encoded), the person id and role go to the child", h["x-sos-role"] === "manager" && decodeURIComponent(h["x-sos-person"]) === "María G" && h["x-sos-person-id"] === "7" && h["x-sos-person-role"] === "lead" && h["x-sos-device"] === "abc123def456abc123def456");
  t("nobody signed in: only the role", JSON.stringify(runner.identityHeaders({ sosRole: "floor" }, null)) === JSON.stringify({ "x-sos-role": "floor" }));
}
{
  const fwd = runner.forwardHeaders({ cookie: "sos_session=x", authorization: "Bearer y", host: "sos.app", "content-length": "9", "x-sos-role": "admin", "content-type": "application/json", accept: "*/*", connection: "keep-alive" });
  t("the cookie, authorization, host, length, any x-sos-* and hop headers never go to a module", !("cookie" in fwd) && !("authorization" in fwd) && !("host" in fwd) && !("content-length" in fwd) && !("x-sos-role" in fwd) && !("connection" in fwd));
  t("an ordinary header does", fwd["content-type"] === "application/json" && fwd.accept === "*/*");
}
{
  const ans = runner.answerHeaders({ "set-cookie": ["sos_session=stolen"], "content-security-policy": "default-src *", "content-type": "text/html", "transfer-encoding": "chunked" });
  t("a module's answer cannot set a cookie", !("set-cookie" in ans));
  t("but its own content type comes back", ans["content-type"] === "text/html" && !("transfer-encoding" in ans));
  t("a module CAN name its content type; the platform sets the page policy itself elsewhere", "content-security-policy" in ans);   // stripped at the mount by lockDown, not here
}

// ---- permission flags
{
  const real = new Set(process.allowedNodeEnvironmentFlags);
  const saved = process.allowedNodeEnvironmentFlags;
  Object.defineProperty(process, "allowedNodeEnvironmentFlags", { value: new Set(["--permission", "--allow-fs-read", "--allow-fs-write", "--allow-net"]), configurable: true });
  const f = runner.permissionFlags(["/app/modules/demo", "/app/node_modules"], ["/run/sock"]);
  t("the flags open exactly the folders passed, read and write, plus the network", f.includes("--permission") && f.includes("--allow-fs-read=/app/modules/demo") && f.includes("--allow-fs-read=/app/node_modules") && f.includes("--allow-fs-write=/run/sock") && f.includes("--allow-net"));
  Object.defineProperty(process, "allowedNodeEnvironmentFlags", { value: new Set([]), configurable: true });
  t("a Node without permission flags returns none (the runner then relies on the user and the database role)", runner.permissionFlags(["/x"], []) === null);
  Object.defineProperty(process, "allowedNodeEnvironmentFlags", { value: saved, configurable: true });
  t("(sanity) the real Node here has the permission flag", real.has("--permission") || real.has("--experimental-permission"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
