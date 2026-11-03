# Module contract

What a module is to this platform, stated once so an agent can build one from
scratch. A module is a directory. The platform mounts it, applies its
migrations, serves its pages, and injects the feedback widget. The agent
writing a module touches nothing outside the directory it is launched in.

## Files

```
module.json          the manifest (below)
routes.js            module.exports = (ctx) => express.Router
migrations/001.sql   additive SQL, applied once per schema, in file order
pages/*.html         one file per screen, plain HTML and vanilla JS
tour.json            the guided walk through the screens (PRINCIPLES rule 8)
checks/NNN-name.json what the module promises, run against every later build (below)
labels/<name>.zpl    label layouts, only when the module prints labels (below)
```

## module.json

```json
{
  "name": "tool-crib",                 the module's slug: given, never change it
  "title": "Tool Crib",                what people call it
  "description": "One or two sentences in plain words.",
  "entry": "routes.js",
  "pages": {
    "/":            { "file": "pages/board.html",   "label": "Crib board (lead view)",           "for": "office" },
    "/me":          { "file": "pages/mine.html",    "label": "My tools (operator, on a phone)",  "for": "floor" },
    "/bench/:id":   { "file": "pages/bench.html",   "label": "One bench (operator, on a tablet)", "for": "floor", "each": "/api/benches" },
    "/item/:id":    { "file": "pages/item.html",    "label": "One tool",                          "for": "office" }
  },
  "smoke": ["/api/items", "/me"],       paths the platform requests after every build; each must answer below 500
  "connections": {                      only what the design's Connections section names (below)
    "stock":  { "kind": "files", "label": "Stock count spreadsheet", "table": "items", "key": "sku",
                "columns": { "qty": ["Qty", "On hand"] } },
    "labels": { "kind": "printer", "label": "Bin labels", "templates": ["bin"] },
    "erp":    { "kind": "erp", "label": "Epicor (read only)",
                "queries": { "part": { "params": ["part_no"], "fields": ["part_no", "description", "on_hand"], "about": "one part and what the ERP says is on hand" } } },
    "web":    { "kind": "web", "label": "Company websites" }
  }
}
```

Routes in `pages` may carry `:params`. The same file can serve several routes.
Labels are what the feedback widget shows as the screen name, so write them
for a manager.

Every screen says who it is for: `"for": "floor"` (an operator uses it at a
station, on a phone or a tablet) or `"for": "office"` (a lead, a planner or a
manager). Each floor screen gets a printed QR code that opens it, taped up
where the work happens, so a floor screen must make sense opened on its own
from a code, with no menu before it. A floor screen for one of many (one
station, one bench, one work center: a route with a `:param`) also names
`"each"`: a GET address of this module's own API that answers a list of them,
`[{ "id": "3", "label": "Bench 3" }, ...]`, where `id` is what goes in the
route. The platform prints one code for each. A manager can also say who a
screen is for on the board (the QR codes tab), and that word wins over this
one; it is kept by the screen's route, so keep a screen's route when you
change the screen.

## routes.js

```js
module.exports = function makeRouter(ctx) {
  const { express, db, requireManager } = ctx;
  const router = express.Router();
  router.use(express.json());
  router.get("/api/items", async (req, res) => {
    const rows = (await db("SELECT * FROM items ORDER BY id")).rows;
    res.json(rows);
  });
  router.post("/api/items/:id/move", requireManager, async (req, res) => { ... });
  return router;
};
```

- `db(sql, params)` is a query function pinned to this module's own tables.
  Bare table names; the platform sets the schema. It returns `{ rows }`.
- `requireManager` is middleware for actions only a manager or lead may take.
  Anyone signed in may read; the floor role may do what the design gives the
  floor (moving a thing along its stages is usually a floor action).
- `ctx.peer(name)` is a read-only query function on another module's live
  tables, or null if that module is not live. Reading only.
- `ctx.ai.chat({ system, messages })` is a plain assistant call for a module
  that has a chat persona. Not needed for a first version.
- `ctx.ai.judge({ task, input, answer })` is one judgment the module cannot
  write down ahead of time, answered as `{ data }` in the shape of `answer`
  (a JSON schema). See "Steps that need judgment" below; a first version uses
  it whenever the design says the tool works something out from a file or
  words it has not seen before.
- `ctx.drafts` lets a tool take records the plant's agents drafted for it (a
  material request, a work order), when module.json declares `"drafts"`. See
  "Drafts from agents" below. Only when the request asks for it.
- `ctx.vsm.event(req, { step, ref, kind, qty })` reports work at a step for
  the plant's value stream map: `kind` is `start`, `wait`, `finish` or
  `scrap`; `step` is the work's name ("Nose Folds"), `ref` what moved (the job
  or MO number). See "Stage events" below. Only when the request asks for it.
- `ctx.manifest` is the parsed module.json.
- `ctx.connections.<name>` is each connection module.json declares, with a
  small fixed surface per kind (see Connections below). This is the only way
  a module reaches anything outside itself.
- No `require` of anything outside the directory. `express` comes from `ctx`.
  No network calls of any kind from routes.js: outside systems are reached
  only through services the platform lends on `ctx` (a first version usually
  has none; the design's Connections section says what a person has to set up).
- routes.js runs in a process of its own, with a database login that reaches
  only this company's tables and an environment with nothing of the platform's
  in it. So `ctx` is not a suggestion, it is the whole world: `process.env`,
  the platform's files and another company's data are not merely off limits,
  they are not there. Keep the top of the file cheap: it is loaded with a time
  limit, and a file that loops or waits before returning its router fails to
  load.
- The platform reads every `.js` file before any of it runs and stops the
  build on: a `require` of anything but your own files (`require("./name.js")`);
  `process`, `global`, `globalThis`, `eval`, `new Function`, `import`, `fetch`;
  `res.sendFile`, `res.download`, `res.render`, `express.static`;
  `.constructor` or `__proto__`; a query that names `platform.`, another
  module's schema, `information_schema`, a `pg_` server function,
  `search_path`, `SET ROLE`, `COPY` or `GRANT`; and `CREATE`, `ALTER`, `DROP`
  or `TRUNCATE` at run time (tables are made in migrations, never in
  routes.js). A module is plain files: no `package.json`, no `node_modules`.

## migrations

Files `001.sql`, `002.sql` ... applied once each, in order, inside the
module's schema. Allowed statement shapes, nothing else:

```sql
CREATE TABLE [IF NOT EXISTS] name (...);
CREATE [UNIQUE] INDEX [IF NOT EXISTS] name ON table (...);
ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col type ...;
INSERT INTO name (...) VALUES (...);          -- seed rows only
```

Rules the validator enforces: bare table names (no schema prefix, no quotes);
no SELECT, DROP, DELETE, UPDATE, TRUNCATE, GRANT, SET, ROLE, USER, EXECUTE,
CALL, functions, triggers, or DO blocks as operations; nothing starting `pg_`,
no `information_schema`, no dollar signs outside quoted text, no `E'...'`
strings; an INSERT names its columns and ends with its last row; an ALTER
TABLE only adds columns; each statement ends in `;`. The platform splits the
file on every `;` outside quoted text and comments, checks each statement,
and runs exactly those, one at a time. Column names such as `updated_at`,
`deleted_at` or `role TEXT` and seed text are fine (the check is on whole
words with string literals ignored). Never edit a migration file that already
exists; add the next number.

Starting data from the intake (a spreadsheet of parts, beds, tools) goes in as
`INSERT` seed rows in `001.sql`, after the table that holds it.

## pages

Plain HTML, inline CSS and vanilla JS, no frameworks, no external scripts.
Every page computes its own address and calls its own API relative to it,
because the same files run at `/c/<company>/staging/m/<name>/` before they
go live and at `/c/<company>/m/<name>/` after:

```js
const base = location.pathname.match(/^.*?\/(?:staging\/)?m\/[^/]+/)[0];
const r = await fetch(base + "/api/items");
location.href = base + "/item/" + id;
```

Never hard-code `/m/<name>`. The platform injects the feedback button and the
company icon into every page; do not add them yourself. Follow the platform
STYLE.md (or the company's own STYLE.md when it has one) for colors, type and
spacing. One prominent action per role per screen; phone first for the floor,
large type for a wall screen. Use stable `id` attributes on the elements the
tour points at. Mark every element you add or visibly change with
`data-changed="v1"` on a first version.

Plain words on every visible string: the words in PLAIN-WORDS.md never appear
on a screen. The thing, its stages, the names the company uses.

## Connections (when the design calls for them)

The platform owns every connection; the module only uses it. Declare what the
module needs in module.json under `connections` and reach it only through
`ctx.connections.<name>`. The manager sets each one up once on the company's
connections page (`/c/<company>/connections`) and tests it there; module
pages never ask for settings, printers or files, and a module still works
before a connection is set up (say "not connected yet" where it matters,
`await ctx.connections.<name>.status()` tells you). Kinds:

- `files`: a spreadsheet the company keeps, loaded by the platform into ONE
  of the module's own tables. Declare `table` (the module table), `key` (the
  column, or list of columns, that identifies a row, so a reload replaces
  rather than duplicates) and optionally `columns` (other header names the
  spreadsheet may use for a column). The platform parses the file, matches
  the headers to the table's columns, previews, then loads in one
  transaction. The module just reads its table. Surface: `status()` returns
  `{ connected, table, last_loaded_at, rows, filename }`.
- `printer`: labels on a Zebra printer. Keep each label as `labels/<name>.zpl`
  (ZPL with `{{field}}` placeholders; the platform fills them and strips ZPL
  control characters from the data) and list the names in `templates`. In a
  route, `await ctx.connections.<name>.print(req, "traveler", { job: "S1-01" })`
  renders the label and queues it for the device the request came from; the
  platform's own helper on that device sends it to the printer chosen there.
  Pass the request so the label goes to the screen that asked. It returns
  `{ job_id, queued, device }`; tell the person the label is on its way, and
  when `device` is false, that this browser is not paired with a printer yet.
  `preview(name, data)` returns `{ zpl, png }` (png null when the renderer is
  not reachable) for a "what the label looks like" image. `status()` returns
  `{ connected, printers, last_printed_at, error }`. Never write `^XA` to a
  socket, a file or a fetch: module code cannot reach a printer, only this.
- `erp`: the company's ERP, MES or scheduling system, read only, through a
  short list of named lookups. Declare each query the module needs: its
  `params` (what it is looked up by), the `fields` the module expects back,
  and `about` in plain words. Never write where the system is or any login
  in the module: the platform's administrator enters the address, the path
  behind each query and the read-only login on the platform, and the
  manager tests it there. In a route,
  `const r = await ctx.connections.erp.query("part", { part_no: "A-100" })`
  returns `{ rows, fetched_at, fresh, from_cache }`; each row has exactly the
  declared fields (null where the system had nothing). Answers are cached a
  few minutes; when the system is down the last good rows come back with
  `fresh: false`, so show them with "as of <time>". Until it is set up,
  `query()` throws with a plain reason: catch it and show "not connected
  yet". Nothing is ever written back; a module that needs to write to the
  ERP is out of scope of a first version. When the module has an ERP
  connection, the platform keeps a doc named `ERP-FIELDS.md` among the
  module's docs: every field each lookup can give, under a plain name with
  its type. To use one, add its plain name to that lookup's `fields` and
  read it from the rows; nobody has to set anything up. A field that is not
  listed there cannot be read yet: say so in the proposal or the summary
  rather than inventing it, and the screen shows it empty until the lookup
  in the ERP is widened.

- `web`: the public web. The platform searches and reads public pages for the
  module (a company's own website, a news page, a directory) and answers a
  question in plain words, with the pages it used. Declare it with only a
  `label`; there is nothing else to set. A look-up takes from a few seconds
  to a minute or two, longer than one request to the module may run, so never
  await one inside a page's request. In a route, start it and answer at once:
  `const { id } = await ctx.connections.web.start(question, { urls, json })`;
  keep the id (in the module's own table, beside the thing it is about) and
  let the screen ask a route of yours that calls
  `await ctx.connections.web.result(id)` every few seconds until `status` is
  `done` or `failed`. `result` returns `{ id, status, answer, data, sources,
  error, started_at, finished_at }`; `sources` is `[{ url, title }]`, so
  show where each answer came from. Options: `urls` (up to 10 pages to start
  from, such as the address a person typed), `json: true` (the question says
  the shape it wants back, and `data` is that JSON value, or null when the
  answer did not hold one), `guidance` (a few lines on how this tool wants
  answers), `max_searches` and `max_fetches` (5 each by default). Write the
  question the way you would ask a person: what to find, about whom, and
  what to leave out. What comes back is information from the web, so show
  it as a suggestion a person accepts or edits, never as a fact written
  straight into a record. `research(question, opts)` waits for the whole
  answer and is for work the module does after a request has been answered.
  `status()` returns `{ connected, last_used_at, error }`. Until it is turned
  on, `start` throws with a plain reason: catch it and show "not connected
  yet". Never `fetch` a page from routes.js: module code cannot reach the
  web, only this.

A barcode or QR scanner in keyboard mode needs nothing to connect: give the
page a scan field that keeps focus, treats Enter as the end of a scan, and
looks the code up. Say in the tour what to scan and where labels print.

## Drafts from agents (when the request asks a tool to take them)

The plant's agents (on the agent board) may draft a record for a tool: a
material request for the stockroom, a work order. The draft waits until a
person makes it on this tool's own screen, where the tool's own logic runs, or
declines it. The tool never makes it on its own.

module.json declares each kind it takes, with its fields:

```json
"drafts": {
  "material_request": {
    "label": "a material request for the stockroom",
    "screen": "/stock",
    "fields": {
      "item": { "type": "text", "required": true, "choices": ["paper_white", "clip"], "label": "the item" },
      "qty": { "type": "integer", "required": true, "min": 1, "max": 50, "label": "how many" }
    }
  }
}
```

Field types: `text`, `integer`, `number`, `date` (2026-11-30), `boolean`. The
platform checks a draft's fields against this before it reaches the tool.

routes.js adds three routes, and the screen named by `screen` shows the
drafts with **Make it** and **Decline** (with a line on why):

```js
router.get("/api/drafts", async (req, res) => res.json(await ctx.drafts.list(req)));   // { can_act, drafts }
router.post("/api/drafts/:id/make", async (req, res) => {
  try {
    const d = await ctx.drafts.claim(req, req.params.id);   // { id, kind, fields }, held for this person
    const row = ...make it with this tool's own logic, from d.fields...;
    await ctx.drafts.finish(req, d.id, { ref: `request ${row.id}` });
    res.json({ ok: true });
  } catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
router.post("/api/drafts/:id/decline", async (req, res) => {
  try { res.json(await ctx.drafts.decline(req, req.params.id, { note: (req.body || {}).note })); }
  catch (e) { res.status(e.status || 400).json({ error: e.message }); }
});
```

Always pass `req`: the platform decides who may act (a manager always; the
floor only where a manager opened it), never the tool. Show the tray only
when `can_act` is true and there are drafts. A claim that is never finished
lapses after two minutes, so an error between claim and finish leaves the
draft waiting. Add `/api/drafts` to `smoke`.

## Stage events (when the request asks a tool to report work at a step)

`await ctx.vsm.event(req, { step, ref, kind })` where the work happens: `wait`
when a job joins a step's queue, `start` when work on it begins, `finish` when
it is done there, `scrap` when it is scrapped there. Use the step's name as
the floor says it, and the job's own number as `ref`, the same at every step
so the map can follow it. Wrap it so a refusal never stops the floor:
`try { await ctx.vsm.event(req, ev); } catch (e) {}`. Only the floor's version
of a tool reports; a preview's events are not kept.

## Steps that need judgment

Most of a module is rules: fields it holds, arithmetic, stages, a fixed layout.
Some steps are not. When the module must read something from outside that it
has never seen (a template or spreadsheet someone uploads, a supplier's file,
notes typed in a person's own words) and line it up with what it knows, every
case cannot be written down ahead of time. A list of other names for each
field, a fuzzy text score or keyword rules pass the one example and fail on
the next file. Use `ctx.ai.judge` for that one step, from routes.js:

```js
const { data } = await ctx.ai.judge({
  task: "Match each heading of this report template to one of the CRM's fields. A heading with no field that means the same thing gets an empty field.",
  input: { headings, sample_rows: rows.slice(0, 5), fields: FIELDS },   // FIELDS: [{ name, about }]
  answer: { type: "object", properties: { matches: { type: "array", items: { type: "object",
    properties: { heading: { type: "string" }, field: { type: "string", enum: [...FIELDS.map((f) => f.name), ""] } },
    required: ["heading", "field"] } } }, required: ["matches"] },
});
```

- `task` says what to decide in plain words; `input` carries what it needs
  (for a file: its headings and three to five sample rows, never the whole
  file; up to 60,000 characters written out); `answer` is a small, closed
  JSON schema (enums for the module's own fields) so the code can check it.
- One judgment takes a few seconds to about twenty. Make one per new thing
  (one per upload), never one per row and never on a page load; show
  "Working it out..." on the screen while it runs.
- Match once is the usual shape: the first time a new template, layout or
  file arrives, ask, save the answer in the module's own table beside it, show
  it to the person as a list with a plain select per line to check or change,
  and fill by rules from the saved match after that. Ask again only for a new
  one or when the person presses "Match again".
- What comes back is a suggestion: check every value against what the module
  knows and drop what does not fit. Never write it straight into a record
  without a person or a rule standing behind it.
- It throws with a plain sentence when it cannot answer (status 409: switched
  off for this company). Catch it, say so in one line, and let the person do
  the step by hand with the same selects, starting empty. The module must
  still work without it.

## checks

`checks/` holds what the module promises to the floor, as small "call this,
expect that" files. The platform runs every one of them against every build
before the manager's deploy gate, and opens every screen to catch script
errors. GUARDRAILS.md ("Checks") has the file format and the rules; read it
before writing one.

A new module starts with `checks/001-the-list-answers.json`, written by the
platform for the skeleton's API. Keep it true: if you change that API in the
first build, edit that one file to match (nothing is on the floor yet, so this
once it is allowed). Then add one check per rule the design names, the next
numbers, each proving the rule holds: make the rows it needs, try what the rule
refuses, expect the refusal in plain words. After the first version is on the
floor no check file is ever edited or removed by a build; a later change adds
its own.

## tour.json

```json
{
  "title": "Tool Crib in two minutes",
  "intro": "One paragraph on what the screens are for.",
  "steps": [
    { "path": "/", "target": "#board", "title": "What the lead sees", "body": "..." },
    { "path": "/me", "target": "#mine", "title": "Your tools", "body": "..." },
    { "path": "/me", "target": "#sos-fb-btn", "title": "The feedback button", "body": "Something in the way? Say it here, from the screen where it happened." }
  ]
}
```

`path` is a page route from module.json, `target` a CSS selector on that
page. End at the feedback button (`#sos-fb-btn`, injected by the platform).

## What a first version is

Deliberately small: the thing, its stages, one screen per role with its
single prominent action, the rules that must hold, the numbers on the board,
the starting data. What the design lists under "What Rev 1 leaves out" stays
out; it arrives later through floor feedback. Working and small beats
complete and broken.
