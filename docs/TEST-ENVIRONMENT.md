# The test floor and the test campaign: concept

*Drafted 2026-09-24 from a scoping conversation with Brendan; pushes 1 and 2 built the same day (see Build order at the end, and the two bullets in CLAUDE.md, "The test floor" and "The test campaign", for what shipped exactly). Hard rules and decisions first, the interaction matrix in the middle (the part that says what changes when the switch is on and what must not change when it is off), open questions last. Update this file as the build lands, the way MODULE-CREATION.md is kept.*

## Hard rules (Brendan, 2026-09-24)

1. **It is a switch per company, off by default, set by the admin.** Not every company has this. With the switch off nothing about it shows anywhere: no link, no step, no bar, no table cell, no route that answers anything but "no test floor". Every suite that ran green before this feature runs green with the switch off and unchanged.
2. **A third lane, one world.** The test floor is a lane of its own beside live and staged: every tool of the company mounted together, on its own tables, in its own process, with its own database login. A build under test runs there beside the other tools at their approved versions, so what one tool reads from another is exercised in one place, on the same data. Nothing on the test floor can reach a row on the real floor or on a preview.
3. **The campaign is a step of the build, before the deploy gate.** When the switch is on, a build that has passed the platform's own checks gets a test campaign: proposed by the AI, approved by the manager, run by the platform, and partly done by a person on the test floor. Deploy waits for a pass, or for the manager's explicit "deploy anyway" with a reason on the record. The manager's gate is unchanged and nothing deploys on its own.
4. **Semi-automated on purpose.** The point is confidence, not only coverage. The campaign has cases the platform runs itself and cases a person does on the test floor with the platform watching: the person does the thing, sees the result, and sees the platform confirm that the tools interacted the way they should. Brendan: "ideally they will do some of it and see the results that it is interacting properly."
5. **Plain words.** Test floor, test campaign, case, "you do", "we watch", "seen". Never lane, schema, fixture, harness, assertion, environment.

## What it is

A company with the switch on gets a **test floor**: every tool it has, open at `/c/<slug>/test/m/<tool>/`, on a copy of data that is not the floor's. A manager or anyone with the company's login can walk around in it any time, move things through stages, print a label, ask Jonah, and nothing on the real floor changes. A violet bar on every test page says so.

Every build then gets a **test campaign** as a step between the platform's checks and the deploy gate. The AI reads the new version, what changed, the tools that read from it and the tools it reads from, its connections and the checks it already carries, and proposes a campaign: a title, a short summary, a data set to run it on, and a list of cases. Some cases the platform runs itself (calls and page loads across one or several tools, in the order a real shift would make them). Some are **guided**: one plain sentence saying what a person should do on which screen, and what the platform will watch for while they do it. The manager reads the list, unticks what is not worth it, adds a case in their own words, picks the data set, and presses Run. The platform rebuilds the test floor with the version under test, runs its cases, then hands the guided ones to a person: the test page itself shows the step for the screen they are on and turns green when the platform has seen the effect. When every case is done the card says so and the deploy gate opens. A failed case goes back to the agent with the person's own words, or the manager deploys anyway with a reason.

## Decisions taken 2026-09-24

| Question | Decision |
|---|---|
| Shape | A third lane per company (`test`), every tool together, own tables, own process, own database login. Not the staging preview with a campaign bolted on. |
| Where the campaign sits | A step of its own after the platform's checks and before the deploy gate, in every lane (UI, functionality, module). Present only when the company's switch is on at the moment the build reaches it. |
| Manual steps | In v1, as guided cases: the person does it, the platform watches for the effect and says "seen", and the person can say "not right" in their own words. A guided case with nothing the platform can watch is a plain tick. |
| Data | The manager's choice per campaign: a fresh copy of the floor's rows (the default), or the made-up set the campaign proposes (named parts, a busy shift, the edge cases). Kept between runs so a person can walk around in it; Reset puts it back. |
| Who switches it on | The admin, on the company card. The manager runs campaigns, does or hands out guided steps, resets the data, opens the test floor. The floor can open the test floor and do guided steps; the verdict buttons stay with the manager. |
| Deploy anyway | Allowed, manager only, a reason required, on the record as a waiver, shown on the shipped tile and counted in loop health. |
| Fix rounds | A campaign that fails can go back to the agent like a failed check. After the fix the same campaign runs again on its own (the manager does not approve the cases twice; guided steps are done again). |
| Cost | One AI call per campaign (the proposal), on the design job's model, the run's A/B arm respected. Roughly 50 cents to a dollar on Fable. Made-up data adds to it. |
| Repo modules | The library modules carry no campaign files. Campaigns live in platform tables, never in a module's files, so the module gate is untouched and an agent can never write one. |

## Words a person reads

- **Test floor**: the lane. "Open the test floor", "Nothing here is real", "the test floor's data".
- **Test campaign**: the step and the thing proposed. "Test campaign: 7 cases, 2 you do yourself."
- **Case**: one thing checked. **You do**: a guided case. **We watch** / **seen**: the platform's confirmation of a guided step.
- The bar on a test page: "TEST FLOOR. Nothing here is real. The floor is on version N." In a campaign it also carries the step for that screen.

## The test floor

**Tables.** `tst_<company>_<tool>` per tool, beside `mod_` and `stg_`. Built FROM THE VERSION'S OWN MIGRATIONS (`applyMigrations` on a fresh schema), then filled: a copy of the floor's rows (columns the two have in common, serial sequences set past the copied ids), or the campaign's made-up rows, or nothing but the migrations' seed rows. Built this way the test tables have sequences of their own, so nothing on the test floor ever advances a sequence on the real floor (staging still does; a known limit there, not here). `_migrations` bookkeeping stays the platform's.

**Login.** A third role, `sos_<company>_tst` (`src/dbroles.js`): SELECT, INSERT, UPDATE, DELETE on every `tst_<company>_*` table and its sequences, nothing on `mod_`, nothing on `stg_`, nothing on `platform`. The role is made when the switch is first turned on and dropped with the company. `grant()` learns the third schema; the hostile suite proves the third role reaches neither of the other two.

**Process.** A third child per company (`src/runner.js`), lane `test`, user id base + 2 in the company's group, the same one-variable environment, the same permission flags, its own socket. `peersOf(company, "test")` hands the child the TEST schemas of the company's tools and the list of tools that are up on the test floor, so `ctx.peer("kpis")` inside a test tool reads the test copy of kpis, never the floor. The live and staged children never learn the test schemas. A crash restarts the test lane alone.

**Mounts.** `/c/<slug>/test/m/<tool>/` (`registry.attach`), `mounts.get(key).test`, `mountTest` / `unmountTest`, `buildRouter` reads the lane off the schema prefix. The browser policy (`modulePagePolicy`) adds the test path to `connect-src` and `form-action`; nothing else widens. The feedback widget is injected with `data-mount="test"`. The library pages already compute `base` from `location.pathname` in a way that keeps `/test/`; the widget's own `modBase()`, `registry.screenFor`, `connections.deviceCookie` and `pageload.sameProblem` learn the third prefix.

**Which version runs there.** `platform.modules.test_version`: NULL means "the floor's version". Outside a campaign every tool runs its live version. During a campaign the tool under test runs the build's `to_version`; the others stay on live. After a deploy (`registry.hooks.deployed`) the tool's test lane moves to the new live version the way a version switch does: code remounted, missing migrations applied, data kept. After a cancel or discard the tool under test goes back to its live version, data kept (older code on a newer additive schema is the documented safe case).

**Data sets.** `platform.test_floors` keeps, per company, the data source in force (`floor` or `made`), the made-up rows if any (`{ <tool>: { <table>: [rows] } }`, at most 200 rows a table, validated against the real columns before a single insert), who set it and when. Reset (manager, `POST /api/c/<slug>/test-floor/reset`) rebuilds every test table from the source in force; the widget on an open test page notices the rebuild and reloads. A campaign's choice becomes the source in force.

**Connections on the test floor.** Same surfaces, with the differences said out loud on the connections page and in the campaign's guided steps:
- *printer*: a label printed from the test floor is a real label on a real printer (that is the confidence step); the job row carries `lane: test`; the guided case says "a label will print; check it and throw it away".
- *files* (spreadsheets): status answers as live; uploads go to the floor only, as today. The made-up data set is how a test floor gets rows.
- *erp*: read only and cached, so a lookup from the test floor is a real lookup (or the cache), which is right: the campaign proves the tool reads the ERP.
- *ai* (Jonah and any persona): a real call, spend recorded with `lane: test`, under the company's budget like any.

**Feedback from a test page.** Ordinary feedback: same screen file, same board. The row carries `detail.lane = "test"` and the card says "sent from the test floor while version N was being tested", so the manager knows it was not the floor. During a campaign the widget also offers "Not right" on the guided step itself, which is the faster path (below).

## The switch

**On** (`POST /api/admin/companies/<slug>/test-floor { on: true }`, admin): the role is made, every tool with a live version gets its test tables from the floor's rows and is mounted on the test lane, `record` `test_floor_on`. The board strip shows "Test floor" on every tool card; the manager's settings page shows "Test floor: on · Open · Reset the data"; the admin card shows the section with status. Boot does the same for every company whose switch is on.

**Off** (`{ on: false }`): refused with a plain sentence while a campaign is running (a matter of minutes). Builds WAITING at the campaign step are moved to the deploy gate with `evidence.campaign = { skipped: "the test floor was switched off" }` and a run log line, never failed. Then: every test mount goes, the test process stops, every `tst_` schema is dropped (the confirm on the admin page says the test floor's data is thrown away), `test_version` cleared, the `test_floors` row kept with `on=false` (so the made-up set survives a round trip), `record` `test_floor_off`. Campaign history stays readable on the cards and in the checks log. Switching on again rebuilds from the floor.

**What "off" means, exactly.** No `tst_` schema, no grants for the third role (the role may exist idle), no test child, `/c/<slug>/test/...` answers 404 "no test floor", the strip has no link, the settings page has no line, the pipeline's step list is the one it had before this feature (the step is inserted at the transition, only when the switch is on), no campaign rows are written, the health table has no campaign cell for that company, the widget never draws the bar. The one thing visible is the admin card's section with the switch.

## The campaign

**Where in the build.** `pipeline.advance`: after `visual_check` (UI lane) or `test_run` (functionality and module lanes) passes, if `testfloor.isOn(company)` the run goes to step `campaign` with status `running` and `campaign.propose(run)` starts; otherwise to `await_deploy` as today. The board's step lists gain "Test campaign" between the checks and the deploy gate, drawn only when the run carries `evidence.campaign_id` or is at that step.

**The proposal** (`src/campaign.js propose`, one structured call on `pipeline.modelForRun(run, "design")`, spend `ai_usage` kind `campaign`). Input: the module's files whole (`modulesource.sourceText`, the same budget rule as the proposer), the requirement or design, the build's diff against the floor's version (a new module: the listing), the plain summary, the sibling tools: each one's `module.json`, `reference.md` and the lines of its `routes.js` that call `peer(` (so the model knows who reads whom), the connections declared and their status, the checks the module already carries (do not repeat what a promise already proves), the last campaign on this module and how it went, GUARDRAILS "Checks" for the step format plus the campaign additions below, PLAIN-WORDS. Output:

```
{ title, summary,
  data: { source: "floor" | "made", why,
          made: { "<tool>": { "<table>": [ { col: value, ... } ] } } },
  cases: [ { id: "c1", title, why, area: "inside" | "across" | "connection" | "role",
             kind: "auto" | "guided", steps: [ ... ] } ] }
```

3 to 12 cases, at most 4 guided. Titles and every `do` sentence pass `plainwords.check` (a rewrite on the short text model, then the check again; a case that still fails is dropped with a log line). What the model is told to cover, in this order: the change itself, in the order a shift would meet it; what each tool that reads this one sees afterwards; what this tool reads from the others; each connection (a print, a lookup, a status); what the floor may and may not do (`as: floor`); one guided case per screen the change touched, with a watch.

**The case format.** A case is a check (GUARDRAILS "Checks": `call`, `page`, `body`, `as`, `expect`, `save`, `note`, 1 to 12 steps, the same matcher) with three additions:

- `module` on any step: which tool the step is made against (default: the tool under test). A step against a sibling is what makes a case "across".
- `do` steps, for guided cases: `{ "do": "On station 1, press Print label on the first traveler", "on": "/station/1", "module": "paperline", "then": { "call": "GET /api/print/jobs", "expect": { "json": { "jobs": { "$minLength": 1 } } } }, "within": 300 }`. The person does it; the platform asks `then` every few seconds up to `within` seconds (default 600) until it matches, then marks the step **seen**. A `do` with no `then` is a plain tick. `then` may name a `module` and an `as` like any step.
- Nothing in a case is a promise. Cases live in `platform.test_campaigns.cases`, never in `checks/`, so an agent cannot write, edit or retire one and the module gate has nothing to learn.

The validator is `campaign.parse` (pure, unit tested), built on `acceptance` so the two formats cannot drift.

**On the card** (status `waiting`, step `campaign`, `campaign.status = proposed`): "Test campaign: <title>. N cases, K you do yourself." with the summary, the cases folded ("See the N cases": each with its title, its area chip inside / across / connection / you do, and a tick box the manager can clear), the data choice (radio: a copy of the floor's data, or the made-up set with a one-line description and the row counts), a box "Add a case in your own words" (a plain guided case with a tick, no AI call), and the buttons: **Run the campaign** (primary), more(Skip this campaign with a reason). `POST /api/runs/:id/campaign/approve { cases: [ids], data: "floor" | "made", added: [{ title, do, on }] }` (`requireManager`, `requireFreshPin`), `.../campaign/skip { reason }`. Skip is a waiver: `evidence.campaign.waived = { reason, by, at }`, record `campaign_waived`, on to the deploy gate.

**Preparing** (`campaign.status = preparing`): the tool under test is mounted on the test lane at `to_version`, its test tables rebuilt from that version's migrations and the chosen source; every sibling's test tables rebuilt from the same source (the floor's rows, or the made-up rows the campaign gave that tool, or the floor's when it gave none). A page open on the test floor reloads. Preparing that fails (a migration, a mount) is a failed campaign with the platform's reason.

**Running** (`running`): auto cases in order, each through `acceptance.runCheck` with per-step bases (`bases[module]` = the test mount of that tool) and the company's service cookies, page steps in the platform's browser when it has one, a fixed timeout per step. A case's result: `{ id, ok, steps, seen }`. Auto cases never touch the floor: the bases are test mounts only, and `campaign.parse` refuses a step whose path or module is not on the test floor.

**Guided** (`walking`): the card lists the guided cases with an "Open the test floor here" link to `on`, and per step the state: waiting for you / seen (with the time) / done by hand / not right. The test page itself shows the step: the widget asks `GET /api/c/<slug>/who/campaign?module=&page=` (under `/who/`, open to every device of the company, read only, nothing a page could misuse) and draws the step for that screen in the bar, then turns it green with "Seen: <what the platform saw>" when the watch matches. Watches are evaluated server side, every 5 seconds while a campaign is walking, whoever has a page open; the evaluation is one call per open step. The person, or the manager on the card, presses **Done** (only needed when there is no watch, or the watch has not seen it within its time: then it is "done by hand, not seen", amber, and the case still passes) or **Not right** (words required: "what did you see?"; the case fails with those words). `POST /api/runs/:id/campaign/steps/:case/:n { answer: done | not_right, what }` (`requireManager`) from the card; `POST /api/c/<slug>/who/campaign/steps/... ` from the test page for any signed-in person, recorded with who. `within` running out is not a fail.

**Verdict.** All auto cases pass and every guided step is seen or done: `passed`, `evidence.campaign` gets the summary, the run moves to `await_deploy` / `waiting`, run log "test campaign passed: N cases, K done on the test floor by <names>", record `campaign_passed`. Any case fails or is not right: `failed`; the run fails at step `campaign` (so the board's stopped-card pattern applies) with `evidence.campaign.failed = [{ id, title, kind, steps, words }]`, the card leads with the failed cases in plain words (a guided one: the person's words), then: **Send findings back** (a fix round: `checksForAgent` gets a campaign section worded as the platform, plus the person's words verbatim; the same campaign runs again after the fix passes the checks, guided steps included), more(Retry from scratch, Deploy anyway, Cancel). **Deploy anyway** is `POST /api/runs/:id/campaign/waive { reason }` (`requireManager`, `requireFreshPin`, words required): `evidence.campaign.waived`, record `campaign_waived`, the run goes to `await_deploy`; the shipped tile says "deployed over a failed test campaign: <reason>" and loop health counts it. Fix rounds: `pipeline.fix` accepts step `campaign`; `MAX_FIX_ROUNDS` shared.

**After.** The campaign row keeps everything: cases as approved, the data choice, every result, who did which guided step, the verdict, the cost. Readable on the checks log page under the run ("Test campaign" with a fold per case) and exported with the checks log. The tool under test stays at `to_version` on the test floor until the build deploys or is cancelled (above).

**A campaign without a build** (not built yet; cheap now that the rest exists): "Run a test campaign on the floor as it is" on the Versions panel (`POST /api/c/<slug>/modules/<m>/campaign`), same proposal, same run, no gate behind it. Its result is a report, nothing else. Worth having for the first day the switch is on and after a made-up data set is loaded.

## Interaction matrix

What each part of the platform does when the switch is on, and the check that it does nothing when it is off. This is the list the e2e suites are written from.

| Part | Switch on | Switch off (must hold) |
|---|---|---|
| `src/db.js` | `companies.test_floor`, `modules.test_version` columns; `platform.test_floors`, `test_campaigns` tables | Columns NULL / false; tables empty |
| `src/migrate.js` | `testSchema()`, `buildTestSchema(schema, versionDir, { fromSchema, rows })`: fresh from the migrations, own sequences, then the rows; validation of made-up rows against real columns | `rebuildStagingClone` and snapshots untouched; `tst_` never in a snapshot |
| `src/dbroles.js` | third lane in `LANES` for `grant` and `dropCompany`; `grantStatements` gives `sos_<co>_tst` the `tst_` schemas only | `grantStatements` emits no line naming the test role unless a `tst_` schema exists |
| `src/runner.js` | lane `test`: user base + 2, `peersOf(company, lane)`; `status()` lists it; `deleteCompany` stops it | No third child is ever started; `peersOf(company, "live")` unchanged |
| `src/runner-child.js` | unchanged: the spec carries the schemas; `peers` message per lane | unchanged |
| `src/registry.js` | `mountTest`, `unmountTest`, `mounts.<key>.test`, `attach` third prefix, `screenFor` third prefix, policy paths, `widgetInject` mount, deploy hook moves the test lane, `unmountCompany` | `attach` answers 404 "no test floor"; `loadAll` mounts nothing on the test lane |
| `src/auth.js` | `/c/<slug>/test/` is under the company prefix: scoped for free; `serviceCookie` unchanged | nothing |
| `src/acceptance.js` | `runCheck` takes `bases` by module and a `watch` mode for `then`; `pathProblem` unchanged | `runAll` and every existing call unchanged (`base` still works) |
| `src/pageload.js` | `sameProblem` strips `/test/m/` too; guided page steps may use the browser | nothing |
| `src/pipeline.js` | step `campaign` inserted at the two transitions when on; `fix` accepts it; `cancel` returns the test lane to live; `deploy` moves it; `checksForAgent` gains the campaign section; `STEPS` for the board | step lists unchanged; `advance` never names the step |
| `src/modulebuild.js` | its `test_run` transition asks the same question; a brand-new module has no siblings reading it yet, the campaign says so | unchanged |
| `src/campaign.js` (new) | propose, parse, prepare, run, watch, verdict, waive, the routes | `isOn` false: every route 404s with "no test floor" |
| `src/testfloor.js` (new) | the switch, data sets, reset, boot, the `/who/campaign` read, the record kinds | idle |
| `src/feedback.js` | board payload: `modules[].test_version`, `test_floor: true`; run payload carries `campaign`; settings page line; `detail.lane` on feedback from a test page | payload carries `test_floor: false` and nothing else new |
| `src/connections.js` | `deviceCookie` on test paths; print jobs and AI spend carry `lane: test`; the connections page says what the test floor does with each kind | nothing |
| `src/agent.js` | JOBS text: design includes the campaign proposal; `recordUsage` kind `campaign` | nothing |
| `src/health.js` | `campaigns` block per company (proposed, run, passed, failed, waived, skipped, guided_seen, guided_by_hand, not_right) and a Health table cell shown only when a company has it on | block absent, cell absent |
| `src/checks.js` | `reasonFor` names "test campaign failed" and "deployed over a failed test campaign"; the checks page shows the campaign under the run; export carries it | nothing |
| `src/record.js` | kinds: test_floor_on, test_floor_off, test_floor_reset, test_floor_data, campaign_proposed, campaign_approved, campaign_skipped, campaign_started, campaign_case, campaign_step, campaign_passed, campaign_failed, campaign_waived | none written |
| `src/backup.js` | `test_floors`, `test_campaigns` in `PLATFORM_TABLES`; `tst_` schemas never dumped; a restore rebuilds the test floor from the floor for every company with the switch on (the made-up set is re-applied from `test_floors`) | nothing |
| company delete | drops `tst_` schemas, the test child, the third role, both tables | nothing extra |
| `src/credit.js`, budgets | the proposal call and test-floor AI chats count like any spend | nothing |
| `src/assess.js`, A/B | the proposal takes the run's arm through `modelForRun`; a campaign is not a head-to-head kind in v1 | nothing |
| `src/modulegate.js` | untouched: campaigns are not files | untouched |
| `public/index.html` | strip link "Test floor", step label, the campaign block on the card (proposed / running / walking / failed / passed), waive and skip, the shipped tile's waiver line, Versions panel "Run a test campaign" | none of it drawn |
| `public/assets/feedback-widget.js` | `mount === "test"`: the violet bar, no news banner, no "did it fix it", reload on test version change or reset, the guided step for this screen, Done / Not right | unchanged on live and staged |
| `public/settings.html` | "Test floor" line with Open and Reset | no line |
| `public/admin.html` | company card section "Test floor": switch, tools up, data source, last reset, Open, Reset; a pill only when a campaign is walking somewhere | the section with the switch off |
| `public/checks.html` | the campaign fold per run | nothing |
| `scripts/e2e/` | `testfloor.js`, `campaign.js`, `campaign-browser.js`, the hostile suite run against the third lane | `run-all.sh` runs every older suite first, switch off |

## Data

- `platform.companies.test_floor BOOLEAN NOT NULL DEFAULT false`.
- `platform.modules.test_version INTEGER` (NULL = the floor's version).
- `platform.test_floors`: company (PK), on, data_source (`floor` | `made`), made_rows JSONB, made_note, set_by, set_person, built_at, reset_at, updated_at.
- `platform.test_campaigns`: id, company, module, run_id (NULL for a campaign on the floor as it is), version, status (`proposing`, `proposed`, `preparing`, `running`, `walking`, `passed`, `failed`, `waived`, `skipped`, `cancelled`), attempt, title, summary, proposed JSONB (the model's whole answer), cases JSONB (as approved: the kept ids, the added ones), data_choice, results JSONB (`{ cases: [{ id, ok, steps, seen, words, by, at }], started_at, ended_at }`), verdict_line, waived JSONB, model, cost_usd, created_at, updated_at.
- The record: one row per event above, `detail` carrying the case id and step number where there is one.

## Cost

One structured call per campaign on the design job's model: the module's source whole (about 15k tokens on the library modules), the siblings' manifests and reference docs and their peer lines (2k to 5k), the diff, the checks (1k to 3k); 3k to 6k out, more with a made-up data set. About $0.45 to $0.90 on Fable 5.1, $0.20 to $0.40 on Opus 5.5. The auto cases cost nothing. A fix round runs the same campaign again for free. `SOS_CAMPAIGN_MAX_ROWS` (200 a table) bounds the made-up set.

## Fake mode

`SOS_FAKE_AGENT=1` returns a canned campaign: three auto cases against the tool's smoke list and its first screen, one across-tool case when the company has a sibling, one guided case on the first screen with a watch on the first smoke path. Markers in the feedback text: `CAMPAIGNFAIL` (the second case fails on the first attempt; a fix round clears it), `CAMPAIGNMADE` (the campaign proposes a made-up set of 5 rows on the first table), `CAMPAIGNNOWATCH` (the guided case has no `then`). `SOS_FAKE_WATCH_MS` makes the fake watch see its step after that long, so the browser suite can watch the bar turn green.

## What v1 leaves out

- Cases kept as promises after a pass (a platform-held set run on every later build). The compounding version of this; after the first real campaigns are read.
- The floor's names on guided steps through the name-and-PIN sign-in (v1 records the device's role and the signed-in person when there is one, and does not require one).
- A campaign that spans two tools' new versions at once (waits on the two-module change from MODULE-CREATION.md).
- Made-up data proposed without a build ("give me a busy Friday"), and saved data sets by name.
- Screenshots of guided steps for the record.
- Photo retention and the interaction record are unchanged; a campaign writes nothing to the record beyond the kinds above.

## Open questions for Brendan

1. The bar's colour and words on a test page: violet with "TEST FLOOR. Nothing here is real." is the proposal. Any objection to violet next to the amber preview bar?
2. Should the floor password alone be able to open the test floor (any device of the company), or only a manager device? The proposal is any device, since guided steps are done on a tablet.
3. A guided step's watch that never sees the effect: the proposal is amber "done by hand, not seen" and the case passes. Or should an unseen watch fail the case?
4. Deploy anyway: manager only with a fresh PIN, or admin only?
5. Should the campaign step be skippable per company by the manager ("run campaigns only when I ask"), or is the admin's switch enough? The proposal: the switch is enough; a manager who does not want one skips it on the card with a reason.

## Build order

Three pushes, each testable on its own; the first two were built and tested 2026-09-24 (43 + 15 + 47 + 19 end to end checks, 22 unit checks, 18 more in the hostile suite; every older suite green with the switch off). What differs from the plan above: a failed auto case does not end a campaign early (the person still does their steps; the verdict comes when everything is closed); the Versions panel has no "Run a test campaign" yet; the interaction record's `actor_person` carries who ticked a step when a name was signed in, no PIN is required.

1. **The switch and the test floor.** Columns and tables, the third role, the third lane in the runner, `buildTestSchema` with own sequences, mounts and the third prefix everywhere, the policy, the widget bar and reload, the admin section and its routes, the strip link, the settings line, Reset, boot, the deploy and cancel moves, company delete, backup and restore. e2e `testfloor.js` (on, walk, write a row on the test floor and prove the floor and the preview did not change, reset, off tears everything down, on again, boot remount, a second company sees nothing) and the hostile suite against the third lane.
2. **The campaign.** `campaign.js` and `testfloor.js`'s read routes, the format and validator, the proposal (real and fake), the step in the three lanes, the card, approve / skip / run / guided steps / watches / verdict / fix / waive / cancel, the widget's step display, record kinds, loop health, the checks log, the campaign on the floor as it is. Unit `test-campaign.js`; e2e `campaign.js` and `campaign-browser.js`.
3. **Read the first real ones.** Run a campaign on the demo company against a real build, read the proposed cases and the made-up data, keep what the model got wrong for the brief. Then the kept-cases question.
