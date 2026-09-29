// The migration validator and how migrations run (src/migrationsql.js, src/migrate.js; the 2026-09-28 bypass).
//   node scripts/test-migrate.js                      the validator, the index self-heal, every migration on disk
//   DATABASE_URL=postgres://sos:sos@127.0.0.1:5432/sos node scripts/test-migrate.js
//                                                     also runs migrations on a real Postgres and proves the payloads
//                                                     never reach it
// Every migration file under modules/ and under any version directory on this disk (MODULES_DIR, else data/modules)
// is checked against the rule as it is now, so a tighter rule cannot quietly break a tool on its next deploy.
const fs = require("fs");
const os = require("os");
const path = require("path");
const V = require("../src/migrationsql");

let pass = 0, fail = 0;
const t = (name, cond, detail) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${name}${detail !== undefined ? "\n      " + JSON.stringify(detail).slice(0, 600) : ""}`); } };
const ok = (sql) => V.validateMigrationSql(sql).ok;
const refused = (sql) => !V.validateMigrationSql(sql).ok;

// ---- 1. the five payloads from the 2026-09-28 finding: every one refused
const FIVE = [
  "CREATE TABLE x (id int); CREATE ROLE evil LOGIN SUPERUSER PASSWORD 'p';",
  "CREATE TABLE x (id int); ALTER ROLE sos SUPERUSER;",
  "CREATE TABLE x (id int); SET search_path TO platform;",
  "INSERT INTO x SELECT rolname FROM pg_catalog.pg_authid;",
  "INSERT INTO x SELECT pg_read_file('/etc/passwd');",
];
for (const p of FIVE) t(`refused: ${p.slice(0, 70)}`, refused(p), V.validateMigrationSql(p));
t("the same-line statements are split and each is judged on its own", V.splitStatements(FIVE[0]).statements.length === 2 && /^CREATE ROLE/.test(V.splitStatements(FIVE[0]).statements[1]));

// ---- 2. the ways around a splitter, and around the INSERT shape
const AROUND = {
  "a block comment hiding the semicolon": "CREATE TABLE x (id int) /* ; */ ; CREATE ROLE evil LOGIN;",
  "a nested block comment": "CREATE TABLE x (id int) /* a /* b */ c */; ALTER ROLE sos SUPERUSER;",
  "a block comment that never closes": "CREATE TABLE x (id int); /* CREATE ROLE evil",
  "a line comment before the next line": "CREATE TABLE x (id int); -- fine\nSET search_path TO platform;",
  "dollar quoting": "CREATE TABLE x (id int); DO $$ BEGIN PERFORM 1; END $$;",
  "a tagged dollar quote": "INSERT INTO x (a) VALUES ($q$text$q$);",
  "a parameter": "INSERT INTO x (a) VALUES ($1);",
  "an escape string that hides a quote": "INSERT INTO x (a) VALUES (E'x\\''); CREATE ROLE evil LOGIN; --'",
  "a unicode escape string": "INSERT INTO x (a) VALUES (U&'\\0041');",
  "a quoted name with a semicolon in it": "CREATE TABLE \"x;y\" (a int);",
  "a string that never closes": "INSERT INTO x (a) VALUES ('open",
  "INSERT with no column list": "INSERT INTO x VALUES (1);",
  "INSERT ... SELECT with a column list": "INSERT INTO x (a) SELECT 1;",
  "INSERT ... RETURNING": "INSERT INTO x (a) VALUES (1) RETURNING a;",
  "INSERT ... ON CONFLICT": "INSERT INTO x (a) VALUES (1) ON CONFLICT (a) DO NOTHING;",
  "INSERT with a subquery in a row": "INSERT INTO x (a) VALUES ((SELECT count(*) FROM y));",
  "a query run from a string inside a row": "INSERT INTO x (a) VALUES (query_to_xml('select rolpassword from pg_authid', true, true, ''));",
  "a whole table read from a string": "INSERT INTO x (a) VALUES (table_to_xml('platform.accounts', true, true, '')::text);",
  "a server file read into a default": "CREATE TABLE x (a TEXT DEFAULT pg_read_file('/etc/passwd'));",
  "a large object import": "INSERT INTO x (a) VALUES (lo_import('/etc/passwd'));",
  "a setting changed from a row": "INSERT INTO x (a) VALUES (set_config('role', 'postgres', false));",
  "a setting read into a default": "CREATE TABLE x (a TEXT DEFAULT current_setting('data_directory'));",
  "CREATE TABLE ... AS SELECT": "CREATE TABLE x (a) AS SELECT rolname FROM pg_roles;",
  "CREATE TABLE ... AS TABLE a catalog": "CREATE TABLE x (a) AS TABLE pg_authid;",
  "the information schema": "CREATE TABLE x (a) AS TABLE information_schema.tables;",
  "an index predicate calling a server function": "CREATE INDEX i ON x (a) WHERE pg_sleep(1) IS NULL;",
  "ALTER TABLE adding a column and altering another": "ALTER TABLE x ADD COLUMN a INT, ALTER COLUMN b TYPE text;",
  "ALTER TABLE adding a column and changing the owner": "ALTER TABLE x ADD COLUMN a INT, OWNER TO evil;",
  "ALTER TABLE adding a column and moving the schema": "ALTER TABLE x ADD COLUMN a INT, SET SCHEMA platform;",
  "SET LOCAL role": "SET LOCAL role postgres;",
  "RESET": "RESET ALL;",
  "EXECUTE": "EXECUTE evil_plan;",
  "CALL": "CALL evil_proc();",
  "CREATE USER": "CREATE USER evil;",
  "GRANT": "GRANT ALL ON ALL TABLES IN SCHEMA platform TO PUBLIC;",
  "a schema-qualified table": "CREATE TABLE platform.x (a int);",
  "another tool's tables": "INSERT INTO mod_other_tool (a) VALUES (1);",
  "LISTEN": "LISTEN evil;",
  "COPY ... PROGRAM": "COPY x FROM PROGRAM 'id';",
};
for (const [name, sql] of Object.entries(AROUND)) t(`refused: ${name}`, refused(sql), V.validateMigrationSql(sql));

// ---- 3. what migrations really say keeps passing
const NORMAL = {
  "a table with defaults, a numeric and a check": "CREATE TABLE IF NOT EXISTS jobs (\n  id SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  qty NUMERIC(6,1) NOT NULL DEFAULT 0 CHECK (qty >= 0),\n  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),\n  due DATE,\n  made_at TIMESTAMPTZ NOT NULL DEFAULT now(),\n  meta JSONB NOT NULL DEFAULT '{}'::jsonb\n);",
  "columns named like operations": "CREATE TABLE people (id SERIAL PRIMARY KEY, role TEXT NOT NULL, owner TEXT, updated_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ, set_id INTEGER, user_id INTEGER, call INTEGER, reset_count INTEGER, rule_text TEXT);",
  "an index on a column named owner": "CREATE INDEX IF NOT EXISTS people_owner ON people (owner);",
  "a unique index on two columns": "CREATE UNIQUE INDEX IF NOT EXISTS people_role ON people (role, set_id);",
  "a partial index": "CREATE INDEX IF NOT EXISTS jobs_open ON jobs (due) WHERE status = 'open';",
  "adding a column": "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS note TEXT;",
  "adding two columns in one statement": "ALTER TABLE jobs ADD COLUMN a INT, ADD COLUMN b TEXT DEFAULT 'x';",
  "seed rows whose text has forbidden words": "INSERT INTO jobs (name, status) VALUES ('Drop off at dock; update the board', 'open'), ('Select a role, then DELETE nothing', 'done');",
  "seed rows with expressions": "INSERT INTO jobs (name, due, made_at, meta) VALUES ('a', CURRENT_DATE + 3, now() - interval '2 days', '{\"k\": 1}'::jsonb), ('b', DATE '2026-10-01', now(), '{}');",
  "seed rows with negative numbers, NULL and booleans": "INSERT INTO settings (key, value, on_off, n) VALUES ('x', NULL, true, -4.5);",
  "a dollar sign inside seed text": "INSERT INTO prices (item, label) VALUES ('clip', 'costs $5 a box');",
  "two statements on one line": "CREATE INDEX a ON jobs (name); CREATE INDEX b ON jobs (due);",
  "a statement that does not end at a line end": "CREATE TABLE t (id SERIAL PRIMARY KEY);   -- a trailing note\n/* a block note */ ALTER TABLE t ADD COLUMN n TEXT;",
  "no semicolon on the last statement": "CREATE TABLE u (id SERIAL PRIMARY KEY)",
  "a semicolon inside seed text is not a split": "INSERT INTO notes (body) VALUES ('first; second');",
  "a typed literal whose type ends in E": "INSERT INTO jobs (name, due) VALUES ('x', DATE'2026-10-01');",
};
for (const [name, sql] of Object.entries(NORMAL)) t(`passes: ${name}`, ok(sql), V.validateMigrationSql(sql));
t("a semicolon inside seed text stays one statement, as written", (() => { const v = V.validateMigrationSql(NORMAL["a semicolon inside seed text is not a split"]); return v.statements.length === 1 && v.statements[0] === "INSERT INTO notes (body) VALUES ('first; second')"; })());
t("comments come out of what runs", V.validateMigrationSql(NORMAL["a statement that does not end at a line end"]).statements.every((s) => !/--|\/\*/.test(s)));
t("a refused file runs nothing (no statements handed back)", V.validateMigrationSql(FIVE[0]).statements.length === 0);
{ const mb = require("../src/modulebuild");
  const sk = mb.skeleton({ slug: "crib-list", title: "Crib list", design: { bluf: "x" }, answers: { thing: "tool", stages: ["out", "back"] }, startingRows: [["Hammer"], ["O'Brien's wrench"], ["Drop saw; 10 inch"]] });
  t("the skeleton a new tool starts from passes, seed rows and all", ok(sk["migrations/001.sql"]), V.validateMigrationSql(sk["migrations/001.sql"])); }
t("a column that only starts like a large object function passes (lo_alarm, a roving watch's low alarm)", ok("CREATE TABLE watch_logs (id SERIAL PRIMARY KEY, lo_alarm NUMERIC, hi_alarm NUMERIC);\nINSERT INTO watch_logs (lo_alarm) VALUES (2);"), V.validateMigrationSql("CREATE TABLE watch_logs (id SERIAL PRIMARY KEY, lo_alarm NUMERIC);"));
t("but calling one is still refused, spaced or not", !ok("INSERT INTO x (a) VALUES (lo_export (1, '/tmp/x'));") && !ok("CREATE TABLE y (a OID DEFAULT lo_creat(-1));"));
t("the fake agent's migration passes", ok("ALTER TABLE stations ADD COLUMN IF NOT EXISTS fake_note TEXT;\n"));

// ---- 4. the index self-heal reads the same statements (src/migrate.js declaredIndexes)
{ const { declaredIndexes } = require("../src/migrate");
  const sql = "CREATE TABLE t (id SERIAL PRIMARY KEY, a TEXT, b TEXT, CONSTRAINT t_ab UNIQUE (a, b), CHECK (a <> 'UNIQUE (b)'));\n"
    + "INSERT INTO t (a, b) VALUES ('CREATE UNIQUE INDEX hidden ON t ((pg_read_file($$/etc/passwd$$)))', 'x');\n"
    + "CREATE INDEX t_a ON t (a);\n"
    + "CREATE INDEX t_bad ON t (a) WHERE pg_sleep(1) IS NULL;\n"
    + "ALTER TABLE t ADD COLUMN c TEXT, ADD CONSTRAINT t_c UNIQUE (c);";
  const d = declaredIndexes(sql);
  const names = d.map((x) => x.name);
  t("an index statement inside seed text is never replayed", !names.includes("hidden") && !d.some((x) => /pg_read_file/.test(x.exec)), d);
  t("an index the validator refuses is never replayed", !names.includes("t_bad"), d);
  t("the real index, the table's named UNIQUE and the added constraint are", names.includes("t_a") && names.includes("t_ab") && names.includes("t_c") && d.length === 3, d);
  t("a UNIQUE inside a CHECK's text is not read as a constraint", !d.some((x) => x.cols === "b"));
  t("the replayed index is the statement as written, made idempotent", d.find((x) => x.name === "t_a").exec === "CREATE INDEX IF NOT EXISTS t_a ON t (a)"); }

// ---- 5. every migration already in a version directory on this disk, and the library modules
{ const files = new Map();
  const walk = (d) => { let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".sql") && /\/migrations\//.test(p)) files.set(p, fs.readFileSync(p, "utf8")); } };
  walk(path.join(__dirname, "..", "modules"));
  walk(process.env.MODULES_DIR || path.join(__dirname, "..", "data", "modules"));
  const bad = [...files].filter(([, sql]) => !ok(sql)).map(([p, sql]) => ({ p, e: V.validateMigrationSql(sql).errors }));
  t(`every migration on this disk passes the rule as it is now (${files.size} files)`, files.size >= 2 && !bad.length, bad.slice(0, 5)); }

// ---- 6. on a real Postgres: what runs is what was validated, and the payloads never reach the server
(async () => {
  if (!process.env.DATABASE_URL) { console.log("(no DATABASE_URL: the Postgres part is skipped)"); return; }
  const { q, pool } = require("../src/db");
  const migrate = require("../src/migrate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  const put = (files) => { fs.rmSync(path.join(dir, "migrations"), { recursive: true, force: true }); fs.mkdirSync(path.join(dir, "migrations"), { recursive: true }); for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(dir, "migrations", f), s); };
  const schema = "mod_migtest_x";
  try {
    await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await q("DROP ROLE IF EXISTS evil");
    for (const [i, p] of FIVE.entries()) {
      put({ "001.sql": p });
      const e = await migrate.applyMigrations(schema, dir).then(() => null, (x) => x.message);
      t(`payload ${i + 1} is refused before anything runs`, e && /rejected/.test(e), e);
    }
    t("no role named evil exists", !(await q("SELECT 1 FROM pg_roles WHERE rolname='evil'")).rows.length);
    t("nothing was made in the schema by a refused file", !(await q(`SELECT 1 FROM pg_tables WHERE schemaname=$1 AND tablename='x'`, [schema])).rows.length);
    put({ "001.sql": "CREATE TABLE jobs (id SERIAL PRIMARY KEY, name TEXT NOT NULL); CREATE UNIQUE INDEX jobs_name ON jobs (name);\nINSERT INTO jobs (name) VALUES ('a; b'), ('O''Brien');", "002.sql": "ALTER TABLE jobs ADD COLUMN role TEXT;" });
    const done = await migrate.applyMigrations(schema, dir);
    t("a normal file runs, statement by statement, in the tool's own schema", done.join(",") === "001.sql,002.sql" && (await q(`SELECT name FROM ${schema}.jobs ORDER BY id`)).rows.map((r) => r.name).join("|") === "a; b|O'Brien");
    t("its index is there", (await q("SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='jobs_name'", [schema])).rows.length === 1);
    const two = await q({ text: "SELECT 1; SELECT 2", queryMode: "extended" }).then(() => "ran", (e) => e.message);
    t("the protocol the statements run through refuses a text holding two commands", /multiple commands|cannot insert multiple/i.test(two), two);
    // the boot audit names a stored file the rule refuses, and says whether the floor already has it
    await require("../src/db").initPlatformSchema();
    await q("DELETE FROM platform.module_versions WHERE company='migtest'");
    await q("INSERT INTO platform.module_versions (company, module, version, source, notes, files) VALUES ('migtest','x',1,'build','t',$1), ('migtest','x',2,'build','t',$2)",
      [JSON.stringify({ "migrations/001.sql": "CREATE TABLE jobs (id SERIAL PRIMARY KEY, name TEXT NOT NULL);" }), JSON.stringify({ "migrations/001.sql": "CREATE TABLE jobs (id SERIAL PRIMARY KEY, name TEXT NOT NULL);", "migrations/003.sql": FIVE[0] })]);
    const audit = await migrate.auditStored();
    const hit = audit.refused.filter((r) => r.company === "migtest");
    t("the boot audit names the stored file the rule refuses, once, with its version and that the floor lacks it", hit.length === 1 && hit[0].file === "migrations/003.sql" && hit[0].versions.join() === "2" && hit[0].on_floor === false && /CREATE ROLE/.test(hit[0].why.join()), hit);
    t("and passes the file that is fine", !audit.refused.some((r) => r.company === "migtest" && r.file === "migrations/001.sql"));
    await q("DELETE FROM platform.module_versions WHERE company='migtest'");
  } finally {
    await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
    await pool.end().catch(() => {});
  }
})().catch((e) => { fail++; console.log("FAIL  the Postgres part threw:", e.message); }).finally(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
