// The migration validator: what a module's migrations/NNN.sql may say, and the exact statements the platform runs.
// Pure (no database), so the module gate and the tests use it too. src/migrate.js runs the statements.
//
// 2026-09-28 rewrite (a verified bypass). Until then the splitter cut only on ";" at a line end and applyMigrations ran
// the RAW file on the platform's own pool, so a second statement on the same line was never looked at:
//   CREATE TABLE x (id int); CREATE ROLE evil LOGIN SUPERUSER PASSWORD 'p';
// passed and made a superuser. Same-line ALTER ROLE and SET search_path passed too, and so did single statements
// like INSERT INTO x SELECT ... FROM pg_catalog.pg_authid and INSERT INTO x SELECT pg_read_file(...). Now:
//   1. The file is split on EVERY ";" outside a string literal, a quoted identifier and a comment ("--" and nested
//      /* */ block comments are both removed). Dollar signs outside a literal (dollar quoting, parameters) are
//      refused, and so are escape strings (E'...', U&'...') whose backslash escapes the splitter does not read.
//   2. Each statement is checked on its own, with string literals blanked, against a short list of shapes:
//        CREATE TABLE [IF NOT EXISTS] name ( ... )
//        CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table ...
//        ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col ...        (one ALTER, nothing but ADD COLUMN)
//        INSERT INTO name (col, ...) VALUES ( ... ) [, ( ... )]      (nothing after the last row, no SELECT)
//      and a list of words that may not appear as operations anywhere in it.
//   3. src/migrate.js runs exactly these statements, one at a time, each through the extended query protocol (which
//      refuses a text that holds more than one command), never the file.
// A forbidden word directly followed by a column type (role TEXT, owner TEXT, call INTEGER) is a column definition,
// not an operation, and is allowed; a parenthesised list of bare column names (an index's columns, an INSERT's column
// list, a UNIQUE constraint) is never an operation whatever the columns are called.

const BARE_IDENT = "[a-z_][a-z0-9_]*";
const TYPES = "TEXT|VARCHAR|CHAR|CHARACTER|INTEGER|INT|INT2|INT4|INT8|SMALLINT|BIGINT|SERIAL|BIGSERIAL|SMALLSERIAL|BOOLEAN|BOOL|NUMERIC|DECIMAL|REAL|DOUBLE|FLOAT|TIMESTAMPTZ|TIMESTAMP|DATE|TIME|TIMETZ|INTERVAL|JSONB|JSON|UUID|BYTEA";
// operations: forbidden as whole words unless the word is a column being defined (followed by a type)
const FORBIDDEN_WORDS = new RegExp(`\\b(DROP|TRUNCATE|DELETE|UPDATE|GRANT|REVOKE|SECURITY|FUNCTION|PROCEDURE|TRIGGER|RULE|EXTENSION|COPY|VACUUM|REINDEX|CLUSTER|OWNER|RESET|DO|ROLE|USER|SET|EXECUTE|CALL|SELECT|LISTEN|NOTIFY|PREPARE|IMPORT)\\b(?!\\s+(?:${TYPES})\\b)`, "i");
// never, not even as a column name: the server's catalogs and admin functions, and the functions that run a query
// given as a string, read or write server files, or change a setting (a VALUES row or a DEFAULT could call them)
const FORBIDDEN_ALWAYS = /\b(pg_\w*|information_schema|query_to_xml\w*|table_to_xml\w*|schema_to_xml\w*|database_to_xml\w*|cursor_to_xml\w*|lo_\w+|dblink\w*|set_config|current_setting)\b/i;
const FORBIDDEN_PHRASES = /\b(ALTER\s+SCHEMA|CREATE\s+SCHEMA|SET\s+ROLE|ALTER\s+TABLE\s+\w+\s+(?:DROP|RENAME|ALTER)\b)/i;
const SCHEMA_REF = /\bpublic\s*\.|\bplatform\s*\.|\bmod_|\bstg_|\bsnap_|\btst_/i;
const ALLOWED = [
  new RegExp(`^CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${BARE_IDENT}\\s*\\(`, "i"),
  new RegExp(`^CREATE\\s+(UNIQUE\\s+)?INDEX\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${BARE_IDENT}\\s+ON\\s+${BARE_IDENT}\\b`, "i"),
  new RegExp(`^ALTER\\s+TABLE\\s+${BARE_IDENT}\\s+ADD\\s+COLUMN\\s+(IF\\s+NOT\\s+EXISTS\\s+)?${BARE_IDENT}\\b`, "i"),
  new RegExp(`^INSERT\\s+INTO\\s+${BARE_IDENT}\\s*\\(`, "i"),
];

// string literals blanked to '' (their text is data, never an operation); the splitter already took the comments out
const stripLiterals = (st) => st.replace(/'(?:[^']|'')*'/g, "''");
const stripIdentLists = (st) => st.replace(new RegExp(`\\(\\s*${BARE_IDENT}(?:\\s+(?:ASC|DESC))?(?:\\s*,\\s*${BARE_IDENT}(?:\\s+(?:ASC|DESC))?)*\\s*\\)`, "gi"), "()");

// -> { statements: [text], errors: [text] }. Comments become a space; everything else is kept as written.
function splitStatements(sql) {
  sql = String(sql == null ? "" : sql);
  const statements = [], errors = [];
  const n = sql.length;
  let cur = "", i = 0;
  const push = () => { const s = cur.trim(); if (s) statements.push(s); cur = ""; };
  while (i < n) {
    const c = sql[i], d = sql[i + 1];
    if (c === "-" && d === "-") { const j = sql.indexOf("\n", i); i = j === -1 ? n : j; cur += " "; continue; }
    if (c === "/" && d === "*") {
      let depth = 1; i += 2;   // Postgres nests block comments
      while (i < n && depth) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
        else i++;
      }
      if (depth) { errors.push("a /* comment is never closed"); break; }
      cur += " ";
      continue;
    }
    if (c === "'") {
      // E'...' and U&'...' read backslash escapes this splitter does not: refused, so it can never disagree with the server
      if (/(?:^|[^a-z0-9_$])(?:E|U&)$/i.test(cur)) { errors.push("escape strings (E'...' or U&'...') are not allowed; write the text plainly"); }
      let j = i + 1;
      for (;;) {
        const k = sql.indexOf("'", j);
        if (k === -1) { errors.push("a quoted text is never closed"); j = n; break; }
        if (sql[k + 1] === "'") { j = k + 2; continue; }
        j = k + 1; break;
      }
      cur += sql.slice(i, j); i = j;
      continue;
    }
    if (c === '"') {
      // a quoted identifier is kept whole (a ";" inside it does not split) and refused by the validator
      const k = sql.indexOf('"', i + 1);
      const j = k === -1 ? n : k + 1;
      if (k === -1) errors.push("a quoted name is never closed");
      cur += sql.slice(i, j); i = j;
      continue;
    }
    if (c === "$") { errors.push("a dollar sign outside quoted text (dollar quoting or a parameter) is not allowed in a migration"); cur += c; i++; continue; }
    if (c === ";") { push(); i++; continue; }
    cur += c; i++;
  }
  push();
  return { statements, errors: [...new Set(errors)] };
}

// After VALUES: one or more balanced ( ... ) rows separated by commas, and nothing else to the end.
function valuesOnly(rest) {
  let i = 0; const n = rest.length; let rows = 0;
  const ws = () => { while (i < n && /\s/.test(rest[i])) i++; };
  for (;;) {
    ws();
    if (rest[i] !== "(") return false;
    let depth = 0;
    for (; i < n; i++) { if (rest[i] === "(") depth++; else if (rest[i] === ")") { depth--; if (!depth) { i++; break; } } }
    if (depth) return false;
    rows++;
    ws();
    if (i >= n) return rows > 0;
    if (rest[i] !== ",") return false;
    i++;
  }
}

const short = (st) => st.replace(/\s+/g, " ").slice(0, 80);
// One statement, as the splitter gave it. -> null when it may run, else the reason.
function statementProblem(st) {
  const bare = stripLiterals(st);
  // a double quote outside quoted text is a quoted name; inside it ('{"k": 1}'::jsonb) it is data
  if (/"/.test(bare)) return `quoted names are not allowed: ${short(st)}`;
  if (/\$/.test(bare)) return `a dollar sign outside quoted text is not allowed: ${short(st)}`;
  const words = stripIdentLists(bare);
  if (FORBIDDEN_ALWAYS.test(bare) || FORBIDDEN_PHRASES.test(words) || FORBIDDEN_WORDS.test(words)) return `forbidden operation in: ${short(st)}`;
  if (SCHEMA_REF.test(bare)) return `schema-qualified name not allowed: ${short(st)}`;
  if (!ALLOWED.some((re) => re.test(bare))) return `statement shape not allowed (additive-only): ${short(st)}`;
  if (/^ALTER\b/i.test(bare) && (bare.match(/\bALTER\b/gi) || []).length !== 1) return `an ALTER TABLE may only add columns: ${short(st)}`;
  if (/^INSERT\b/i.test(bare)) {
    const m = new RegExp(`^INSERT\\s+INTO\\s+${BARE_IDENT}\\s*\\(\\s*${BARE_IDENT}(?:\\s*,\\s*${BARE_IDENT})*\\s*\\)\\s*VALUES\\s*`, "i").exec(bare);
    if (!m || !valuesOnly(bare.slice(m[0].length))) return `an INSERT is INSERT INTO table (columns) VALUES (...) and nothing more: ${short(st)}`;
  }
  return null;
}

// -> { ok, errors, count, statements }. statements: exactly what may run, in order (src/migrate.js runs these).
function validateMigrationSql(sql) {
  const { statements, errors } = splitStatements(sql);
  const out = [...errors];
  if (!statements.length && !errors.length) out.push("migration file contains no statements");
  for (const st of statements) { const p = statementProblem(st); if (p) out.push(p); }
  return { ok: out.length === 0, errors: out, count: statements.length, statements: out.length ? [] : statements };
}

module.exports = { splitStatements, validateMigrationSql, statementProblem, stripLiterals, BARE_IDENT };
