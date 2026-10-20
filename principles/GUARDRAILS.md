# Agent guardrails

Hard limits on what a build agent may do. The platform enforces most of these
structurally; treat the rest as absolute instructions.

- Your write surface is the draft version directory you are launched in. Nothing else exists.
- Never modify the platform, another module, or any file outside your working directory.
- UI-class changes: touch `pages/` and presentation only. Do not modify `routes.js` logic, `module.json`'s smoke list, or migrations. The platform compares the files after the build: in a UI-class change only `pages/`, `tour.json`, `reference.md` and the labels, title and description in `module.json` may differ from the live version, and the build is stopped otherwise. If the change cannot work without touching `routes.js`, leave it untouched and say so in your summary; the manager will approve it again as a functionality change.
- Functionality-class changes: implement exactly the confirmed requirement. Nothing extra.
- Data model changes go in a NEW `migrations/NNN.sql` file. Additive only: `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN` (nothing but added columns), `CREATE INDEX`, and seed rows as `INSERT INTO table (columns) VALUES (...), (...)` with the column list and nothing after the last row. Every statement ends in `;`. Bare table names, no schema prefixes, no quoted identifiers, no dollar signs outside quoted text, no `E'...'` strings. Never edit an existing migration.
- Never use SELECT, DROP, DELETE, UPDATE, TRUNCATE, GRANT, SET, ROLE, USER, EXECUTE, CALL, `pg_` anything, `information_schema`, or any schema/role/function statement in a migration. The platform splits the file into statements, checks each one, and runs only what it checked, one at a time. (Column names like `updated_at` or `role TEXT` and words inside seed text are fine; the check is on operations. `now()`, `CURRENT_DATE` and casts are fine in defaults and seed rows.)
- Keep the stack boring: plain HTML, vanilla JS, no frameworks, no new dependencies.
- Module routes receive `ctx.db` (a query function pinned to this module's tables) and `ctx.requireManager` (middleware for manager-only actions). Do not import anything from outside the directory except `express` via `ctx.express`.
- The platform reads every `.js` file in the module before any of it runs, and stops the build if server code reaches past what `ctx` lends it. In `routes.js` and any helper file: `require` only your own files, written as `require("./name.js")`; never `process`, `global`, `globalThis`, `eval`, `new Function`, `import`, `fetch` or any other network call; never `res.sendFile`, `res.download`, `res.render` or `express.static` (the platform serves the pages listed in `module.json`); never `.constructor` or `__proto__`. No `package.json`, no `node_modules`.
- Queries in `routes.js` use bare table names from this module's own migrations. Never `platform.`, another module's schema (read a sibling module with `ctx.peer(name)`), `information_schema`, `pg_` server functions, `search_path`, `SET ROLE`, `COPY` or `GRANT`. Never `CREATE`, `ALTER`, `DROP` or `TRUNCATE` at run time: a change to what the tool keeps is a new migration file. `SELECT`, `INSERT`, `UPDATE` and `DELETE` on your own tables are the normal work of a route.
- Pages call their own APIs with paths relative to the page (see how the existing pages compute `base`), never hard-coded `/m/<name>` paths, because the same files run at `/staging/m/<name>` before they go live.
- If the requirement is ambiguous or seems to require more than allowed here, stop and say so in your summary instead of guessing.

## Checks: the promises a change leaves behind

`checks/` holds small files the platform runs against EVERY later build of this
tool, before the manager's deploy gate, together with a load of every screen
that stops a build on a script error. Each file is a promise an earlier change
made to the floor. Read them before you change anything: they say what must
keep working.

- A functionality-class change adds ONE new file, `checks/NNN-short-name.json` (the next number; lowercase words joined by dashes), that proves the change works. Build it from the confirmed requirement's "how we will know it works". A UI-class change adds none (it may not touch `checks/`).
- Never edit or remove a check that already exists. If your change makes an older check fail, change your work so it passes again while still doing what was asked. Only a manager can retire a promise; you cannot. If the confirmed requirement itself contradicts an older promise (it asks for one shift start for the line where a promise says every tile shows its own), do not quietly pick a side: keep the old promise true as well where you can, and say in your summary which promise the requirement contradicts, in its title's words, so the manager can retire it.
- If a change truly cannot be checked this way (it only prints a label, say), add no file and say why in your summary.
- The title is one plain sentence a manager can read, 8 to 200 characters: what the floor can count on from now on. No code words. Longer than 200 and the platform stops the build before anything runs, so say it short.
- A check never calls a route that prints a label, asks an AI persona or a judgment (`ctx.ai.chat`, `ctx.ai.judge`), or reaches an outside system to change it: check the rule around it instead (the row was made, the refusal was given).
- A check makes the rows it needs and asserts shapes and rules, never today's numbers. It runs against a copy of the floor's data, which is thrown away afterwards, so it may add and change rows.

```json
{
  "title": "A material request can ask for more than one sheet",
  "steps": [
    { "call": "POST /api/requests", "as": "floor", "body": { "item": "paper_white", "qty": 3 },
      "expect": { "json": { "id": { "$type": "number" }, "qty": 3 } }, "save": { "id": "id" } },
    { "call": "GET /api/stock", "expect": { "json": { "requests": { "$contains": { "id": "{id}", "qty": 3 } } } } },
    { "call": "POST /api/requests", "as": "floor", "body": { "item": "paper_white", "qty": 0 }, "expect": { "status": 400 } },
    { "page": "/stock", "expect": { "status": 200, "visible": ["3 sheets"] } }
  ]
}
```

- 1 to 12 steps, run in order; the first step that fails stops the check. `call` is `METHOD /path` (GET, POST, PUT, PATCH, DELETE) and `page` is `/path`; both are paths inside this tool, exactly as the pages call them after `base`. Never an address, never `..`.
- `as` is `"manager"` (the default) or `"floor"`: the step is made with that kind of login for this company. Use `"floor"` to prove the floor can do something, or that it cannot (`"expect": { "status": [401, 403] }`).
- `expect.status` is a number or a list; left out, any 2xx passes. `expect.json` is matched as a SUBSET: every key you name must match, other keys are ignored. A plain value must be equal. Rules go under the field: `$type` (string, number, boolean, array, object, null), `$gte` `$lte` `$gt` `$lt`, `$in` (a list), `$regex`, `$exists` (true or false), `$length`, `$minLength`, `$contains` (some entry of a list matches), `$every` (all entries match), `$not`. A list written out must match entry for entry.
- `expect.contains` and `expect.lacks` are lists of text the raw answer (or the page's HTML as served) must or must not contain. On a `page` step, `visible` (text a person sees after the page has loaded its data) and `selector` (CSS selectors that must match something) are looked at in a real browser when the instance has one.
- `visible` is read off the screen as it first opens, about a second after load, with nothing tapped, typed, chosen or scrolled. So never put in `visible`: text behind a tap (a close-up, a dialog, a menu, a tab, a row's details), text that depends on the rows of the day (a time, a count, a name or serial from seed data, "3 blades" when the rows could change), or text you are not sure the page renders on its own. Use a fixed label the page always draws (a heading, a button's words, a column head) or a `selector` for the element; prove the rows and the rules with `call` steps and `expect.json`, where a value the check itself created is safe to look for. Most checks that fail on a build that is otherwise right fail on a `visible` guess.
- `save` carries a value from a JSON answer into later steps: `{ "id": "request.id" }` reads `answer.request.id`; use it as `{id}` in a later path, body or expectation.

