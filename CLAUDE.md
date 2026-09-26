# Symbiotic OS: Workspace Guide (current as of 2026-09-25)

**This file is the single source of truth for how this repo and the live
instance are worked on.** Repo: `brf1998-code/SymbioticOS` (private). Live:
https://app.anetix.ai (and still https://sos.finnoperations.com; Railway
project `symbiotic-os`, service `SymbioticOS` + `Postgres`). The public front
door, anetix.ai, is a SEPARATE small service (the `www/` folder beside `sos/`,
its own repo and Railway service; see "Self-serve companies from anetix.ai").

## Shape of the instance (since 2026-09-11)

One instance hosts many **companies**. Everything is scoped by company slug:
- `/c/<slug>/` improvement board, `/c/<slug>/settings` the manager's one
  settings page (people, printers and spreadsheets, the wall sign, what
  happens when a request arrives), `/c/<slug>/agents` model choices and agent
  docs (reached from the admin page since 2026-09-20, not the board),
  `/c/<slug>/m/<module>/` live module pages,
  `/c/<slug>/staging/m/<module>/` the preview of a build (amber bar on every
  staged page, reloads/leaves when the staged version changes).
- `/admin` (admin role: a named account with an authenticator app since
  2026-09-21, see "Named admin accounts"; `SOS_ADMIN_PASSWORD` opens it only
  until the first authenticator is set up) lists companies, their modules,
  docs, spend, and adds companies or library modules to them.
- **The admin page is seven tabs, one job each** (2026-09-21, `public/admin.html`; Pins and Demos added 2026-09-25, Sites 2026-09-26, ten now
  plus the standard header `public/assets/admin-shell.js` and
  `admin-shell.css`; Brendan: the page had become fix stacked on fix and he got
  lost in it). The header is on every tab: the navy band, who is signed in,
  sign out, a row of status pills (AI credit, AI spend against the instance
  cap, Waiting on us = open data requests, Isolation, Edge, Sign-in; each is a
  link to the tab that holds the detail, amber or red when it wants a look) and
  the tab row, where a tab carries a count (Companies, Library) or a dot when
  something on it wants looking at. The tab in view is the address's hash, so it
  can be linked, reloaded and reached with the back button: `/admin#health`
  (the default), `#companies/<slug>`, `#companies/new`, `#library`,
  `#models`, `#accounts`, `#instance`, `#requests`, `#pins`, `#demos`, `#sites` (Models since 2026-09-22,
  see "Two models, one baseline"; Requests since 2026-09-24, see "Requests to
  Anetix"; Pins since 2026-09-25, see "Self-serve companies from anetix.ai"). **Health**: data requests first when there are any
  ("waiting on us"), then the fleet tiles and the per-company table; the long
  "how to read these numbers" text is folded. **Companies**: a list on the left
  (open feedback, modules, spend this month, a red line when sign-in needs
  setting) and ONE company open on the right, in sections: Go to (the links
  that left the board), Modules (open, tour, add from the library, New module),
  Sign-in, AI budget and models, Brand, Agent docs, Danger zone. Add a company
  is the last entry of the list and opens in the same pane. **Library**: see
  "Module library and tours". **Accounts**: the admin accounts, My account, Add
  an account, the sign-in log. **Instance**: AI credit and the glide slope,
  spend and default models (with each company's spend and own cap), module
  isolation, the edge check, backup and restore. Older bullets below that say
  "the top card on /admin" or "the accounts card says whether this request
  carried the header" mean these tabs: loop health is Health, AI credit and
  isolation and the edge check are Instance. No API changed apart from the
  library in `/api/admin/overview`. Every loader drops what it learned into `P`
  and calls `drawPills()`; a new instance-wide warning belongs there as a pill,
  not as another card on top of a tab. The ids the e2e suites hold on to are
  unchanged (`#health-card`, `#h-table`, `#credit`, `#credit-line`,
  `#companies .card .links`, `#accounts-card`, `#acc-list`, `#acc-events`,
  `#enroll-card`, `#edge-line`); a suite that needs a tab goes to its hash.
  An account with no authenticator still sees the setup and nothing else: the
  band without pills or tabs, `#enroll-card` outside `<main>`, and everything
  in `<main>` hidden. The shell is its own two files so the other admin-side
  pages can take the same header later (decided: /admin only for now); /assets
  is served before the login, so nothing secret goes in them.
- Module schemas are `mod_<company>_<module>` / `stg_...` / `snap_...`. The
  first boot after this change renamed the old `mod_paperline` schema and
  moved everything under company `demo` (`src/db.js upgradeSingleTenant`).
- Feedback records the **screen** it came from (label + file, resolved from
  the module manifest's `pages` map, which now carries labels). Proposals
  carry `target_file`; the build prompt pins the change to that file; the
  cross-check fails a diff that lands on another screen. The manager can
  change the target in the Adjust form.
- Model jobs: propose / build / review / design; a company can pin the first
  three on its Agent settings page, everything else follows the instance
  (see "Two models, one baseline", 2026-09-22). The board names no model and no cost anywhere since
  2026-09-20 (the per-run override in Adjust, the batch bar's model select
  and the system review's model select are gone; the API still accepts
  `model` and falls back to the company's build model). `src/agent.js
  MODELS` is the two models on offer and `PRICE_ONLY` prices the short text
  models and Opus 5; keep both current with
  platform.claude.com/docs/en/models/overview.
- Agent docs: repo `principles/*.md` are platform-wide and read-only in the
  app; each company has editable docs in `platform.agent_docs` (COMPANY.md
  seeded, module `reference.md` seeded from `principles/module-formats/`).
  Every run records which docs it was guided by (`evidence.docs`).
- Old URLs `/m/<module>` redirect to `/c/demo/m/<module>`.
- **System review** (`src/review.js`, `platform.reviews`): a whole-module
  re-baseline by a chosen model (Fable by default). Input: guidance docs, all
  live files, feedback and build history, a live-data snapshot from the
  manifest's `/api/...` smoke endpoints. Output: 3 to 12 findings, each filed
  as a held feedback item (`review_id`, status reviewing) with a draft
  proposal (class, target_file, priority in rationale). Building the approved
  set is the normal batch run. One review per module at a time.
- **Diagrams** (`src/diagrams.js`, `platform.diagrams`): after every deploy
  (`registry.hooks.deployed`) the propose model draws two Mermaid sets for the
  new version, data flows and one workflow per role, following
  `principles/DIAGRAMS.md` (the adjustable conventions file; edit it when the
  drawings are not landing). Shown at `/c/<slug>/diagrams/<module>` with a
  version selector and a manager-only Redraw button (`POST
  /api/c/<slug>/diagrams/<module>/regenerate`). Rendered client-side by
  mermaid from cdnjs; if the CDN is unreachable the page shows the source.
  Boot draws diagrams for any module version that has none.
- **Version jumps** (`registry.goToVersion`, board "Versions" panel per
  module, `GET/POST /api/c/<slug>/modules/<m>/versions|goto`): any version,
  back or forward. Switch keeps today's data (additive migrations make older
  code safe on a newer schema; newer code re-applies missing migrations).
  Restore also puts back the data snapshot taken when that version was last
  live. Every jump snapshots the current state first, so jumps are reversible.
  Snapshot retention `SOS_KEEP_SNAPSHOTS` (default 10). The Done card's Roll
  back is one restore step to the nearest older snapshot.
- **Structured calls** (`agent.runStructured`): forced `tool_choice` is
  rejected by Fable 5.1 and Opus 5.5; both are marked `forcedTool: false` in
  `MODELS` and asked with `auto` plus an instruction from the first call
  (any other model that refuses is remembered for the process). Review and diagram calls use a 16k
  output budget.
- **Batch tiles**: a run with several proposals renders as ONE card on the
  board (in progress and done), with the changes collapsed under "See the N
  changes", the requirement in full at the confirm step, and one "We did"
  line when deployed. The feedback items in it are folded into the tile
  while the run exists (cancel puts them back as their own cards).
- **Plain summaries** (`pipeline.plainSummary`, on the short text jobs' model, Sonnet 5 by default since 2026-09-22, Haiku before; a fraction of a cent): after every
  build, a title (<= 8 words) and a one-to-three sentence "what changed" go
  into `evidence.title` / `evidence.what_changed`; the title becomes the
  version's `notes` (shown in the Versions panel) and what_changed is the
  feedback outcome and the Done card text. The model is set on `/admin#models`
  ("Short text jobs"); `SOS_MODEL_SUMMARY` only seeds it until one is saved.
  The `build_summarized` record carries `detail.model`.
- **Build-agent models, Agent SDK 0.3.x (2026-09-17)**: every model in
  `MODELS` can be the builder, Fable 5.1 included. The old "Fable exits 1
  after its first reply" was the Agent SDK pinned at 0.1.77 (January 2026,
  before Fable existed); `package.json` now pins `^0.3.274`, which bundles
  Claude Code 2.1.274 as a native binary per platform (optional dependency
  `@anthropic-ai/claude-agent-sdk-linux-x64` on Railway) and needs
  `@anthropic-ai/sdk` >= 0.93, `zod` 4 and `@modelcontextprotocol/sdk` as
  dependencies. `package-lock.json` must be regenerated in the cloud sandbox
  (the Mac VM has no network) whenever dependencies change. `runAgent` now
  passes `tools` (the whole tool list: Read, Write, Edit, Glob, Grep and
  nothing else; the init message confirms it), `effort` (`SOS_AGENT_EFFORT`,
  default `high`, decided 2026-09-17: high everywhere) and `maxBudgetUsd` at
  three times the run cap as a far safety rail (our own estimate still stops
  the run at the cap). `agentEnv()` sets `CLAUDE_CODE_NO_MODEL_FALLBACK=1` so
  the CLI can never swap models silently, and the run records every model id
  the agent reported (`evidence.models_seen`, plus `evidence.effort`); the
  board shows a check mark after the model name when it matches and a red
  "ran on X" when it does not. A turn that ends on an API error comes back
  from this SDK as subtype `success` with `is_error`; the runner throws on it
  instead of storing the error text as the build summary. `MODELS[].agent
  === false` still works to keep a model out of builds; nothing uses it now.
  Structured calls keep the `tool_choice` fallback (Fable still rejects a
  forced tool).
- **Two models, one baseline** (2026-09-22, `src/agent.js`, `src/assess.js`,
  `health.abSplit`, `public/assets/admin-models.js`, the Models tab of
  `/admin`; Brendan: every request structure on Fable 5.1 or Opus 5.5, and an
  assessment to decide which is the baseline). Opus 5.5 came out that day
  (`claude-opus-5-5`, $4 / $20, ahead of Fable 5.1 on Anthropic's agentic
  coding numbers; like Fable it refuses a forced `tool_choice`). **The tier**:
  `MODELS` is exactly the two; the short text jobs (the plain summary after a
  build, the plain-words rewrites of the intake) have a model of their own,
  `settings.summary`, from `SUMMARY_CHOICES` (Sonnet 5, the default since the
  same evening, Brendan: "why keep things on Haiku 4.5 when we could use a
  better model at marginal cost"; Haiku 4.5; or either main model),
  `summaryModel()`, seeded by `SOS_MODEL_SUMMARY`; `PRICE_ONLY` prices those
  two and Opus 5 (old rows only); `inTier(id)` is the one test, so every
  `MODELS.some(...)` check in the code now refuses a retired model. **Jobs**
  (`JOBS`): propose (the proposal on arrival, the requirement before a
  functionality build, diagrams, ERP lookup drafts, a module's chat default),
  build, review (the cross-check), design (a new module's intake questions
  and design, its first build and that build's check, system reviews, brand
  guides). **Resolution** (`modelFor(company, job)`): the company's pin
  (propose / build / review only, `platform.companies.model_*`, and only if in
  the tier) then the instance's model for that job then the baseline. The
  instance side is ONE row, `platform.settings` key `models` = `{ baseline,
  jobs: { <job>: id }, summary, ab: { on, jobs, since, by, ended }, set_at, set_by }`
  (`instanceModels` / `setInstanceModels`, cleaned by `cleanSettings`);
  `SOS_MODEL_BASELINE` only seeds the first baseline (Fable). The old per-role
  variables are not read (`RETIRED_ENV`; boot logs `[models] ... no longer
  read` and the tab shows them to delete). Boot also clears any company pin on
  a retired model (the old Agent settings page pinned whatever was in force
  every time it was saved; the page now offers "Platform's model (now X)"
  first and "Pin <model>" after, and saving untouched pins nothing). Hard-coded
  Fable defaults are gone from intake, module build, brand, system review and
  the checks replay: each asks `modelFor(..., "design")` or `"review"`.
  **The live A/B** (`pickModel(company, job, ref)`, `keepArm`,
  `platform.model_arms`): for a job in the test (`AB_JOBS`: propose, build,
  design) that the company has not pinned, the model that has had FEWER of
  that job since the test began, a coin on a tie; kept under a ref
  (`feedback:<id>` for a proposal, so a redraft keeps its arm; `run:<id>`;
  `intake:<id>`). A build's arm is kept on the run (`evidence.ab = { arm,
  since }`) and `pipeline.modelForRun` puts that run's requirement and
  cross-check on the same arm (company pin first): an A/B run is one model end
  to end. `health.abSplit` (pure) runs `metrics()` over each arm's runs,
  proposals and feedback only (builds started / shipped / rolled back, stops
  by kind, fix rounds, met / missed once live, start to the deploy gate, spend
  per run and per shipped), plus proposals drafted / approved / edited /
  declined and intakes per arm; `AB_MIN_RUNS` = 10 builds an arm before the
  page reads anything into it. Stopping keeps `since` and sets `ended`, so the
  last test's numbers stay. **The head-to-head** (`platform.assessments`,
  `assessment_trials`, `assessment_picks`; routes `/api/admin/assess*`,
  admin only): stored work done again by both models with the brief a real
  call gets (`pipeline.buildPrompt` and `proposals.proposalRequest` were
  pulled out of `advance` and `generateProposal` for this, byte for byte the
  same prompts), nothing written anywhere a company sees. Kinds: `crosscheck`
  (runs labeled Right / Wrong on the checks page; `crossCheckCall` on
  `diffForRun`; scored against the label the way the checks page reads it),
  `proposal` (requests whose proposal was approved, drafted again forced (no
  sorting, no question) against the module version the build started from,
  `moduleContext({ version })`; scored on class and screen against what the
  manager approved), `design` (intakes that reached a design;
  `intake.generateDesign(it with the model, null, { usageKind: false })`;
  scored by plain-words flags), `build` (deployed runs, built again in a
  scratch folder `os.tmpdir()/sos-assess-<trial>/versions/<from|to>`, then the
  module gate and a cross-check by BOTH models, so no build is graded only by
  its own model; UI builds are cross-checked here too, which the pipeline does
  not do). One trial at a time in the background, the two models take turns
  going first, spend is `ai_usage` kind `assess` (company budgets, the
  instance cap and the credit slope all see it), an assessment has its own
  `budget_usd` and stops at it, and stops on an AI-service or budget refusal
  rather than failing every trial after; a running one resumes after a
  restart. Blind picks: proposal, design and build cases show Left and Right
  with no model, cost or time (`blindView`), the side a fixed sha256 coin per
  case (`sides`), the pick reveals the models afterwards and can be changed.
  The scorecard (`scorecard`, pure) and its reading (`reading`, rules in
  `RULES`, shown on the page): a kind counts at 5 cases done on both (and 5
  picks when blind); the non-baseline model is worse on a kind when it lost 2
  or more picks than it won or its objective share is 15 points or more under;
  one kind worse keeps the baseline; nothing worse and cheaper suggests the
  switch, with a "Make X the baseline" button. The admin changes the baseline;
  nothing changes it on its own. Method and how to read it:
  `docs/MODEL-ASSESSMENT.md`. **Agent SDK 0.3.280**: 0.3.274's bundled CLI has
  no `claude-opus-5-5` in it (the same trap 0.1.77 was for Fable); 0.3.280
  (published the same day) has it, and a one-turn agent run on each model
  came back reporting that model (`modelsSeen`). Tests:
  `scripts/test-models.js` (40, no database), `scripts/e2e/models.js` (63,
  fake mode, fresh database, started with `SOS_MODEL_PROPOSE=claude-sonnet-5`
  so the retired warning shows) and `scripts/e2e/models-browser.js` (24,
  playwright, right after models.js on the same database). The tables are in
  the backup and in company delete. Known limits: the cost estimate per case
  is rough (fixed token sizes); a build trial runs the gate and the reviewers
  but not the acceptance checks or the page load (those need a staged mount,
  the live A/B covers them); a proposal trial reads today's company docs;
  "the agent" is the only name for the designer in the intake flow, whichever model runs it; no model or vendor name in anything a company sees.
- **Boot id**: `SOS_BOOT_ID` is set at process start and returned by the
  board API; the board reloads itself when it changes, so an open tab picks
  up a redeploy instead of running old page code against new data.
- **Failed checks**: a build that fails the cross-check, the tests, or the
  visual check keeps its draft staged (preview still opens). The manager can
  `POST /api/runs/:id/fix` (agent revises the SAME draft version with the
  findings; `evidence.fix_round`, max `SOS_MAX_FIX_ROUNDS` = 2),
  `POST /api/runs/:id/override` (cross-check only; runs the tests, then the
  deploy gate; `cross_check.overridden` recorded), retry from scratch, or
  cancel (which now unstages the draft).
- **Automatic fix rounds** (2026-09-25, `autoFix` in pipeline.js, from the
  checks failure review in the project): `failRun` sends a build that failed
  the cross-check, the module gate, the tests or the visual check straight
  back to the agent with the findings, same draft, up to
  `SOS_AUTO_FIX_ROUNDS` (default 2) times; then it stops as before with one
  manual round left (`SOS_MAX_FIX_ROUNDS` default is now 3). Never for a
  failed test campaign, an AI outage, a cost cap, a restart, or the smoke
  check's "could not sign itself in". Logged as "the platform sent the
  findings back to the agent on its own (fix round N of 3)", recorded as
  `run_fixed` with actor `platform` and `detail.auto`. `sweepOrphans` now
  starts a run cut off by a redeploy again from scratch, once
  (`evidence.restarted`; `SOS_RESTART_ORPHANS=0` marks them failed instead).
  The review found the two biggest stop causes were guidance gaps: check
  titles over 160 characters (cap now 200, `acceptance.MAX_TITLE`, and the
  number is in GUARDRAILS and the build prompt) and `visible` text the
  screen only shows after a tap or from seed rows (GUARDRAILS says what
  `visible` may hold). `migrate.js` blanks a parenthesised column list
  before the forbidden-word test (`ON items (owner)` was refused, run #58).
  E2E: `scripts/e2e/autofix.js`; the other suites run with
  `SOS_AUTO_FIX_ROUNDS=0` because they press Fix themselves.
- **Cost caps are off by default** (2026-09-17, Brendan: development mode,
  spend what the work needs). `SOS_MAX_RUN_USD`, `SOS_MAX_BATCH_USD` and
  `SOS_MONTHLY_CAP_USD` unset or 0 mean no cap; set them to bring caps back
  (per change, per batch run, per month). With no cap the runner passes no
  `maxBudgetUsd` to the SDK either; `maxTurns` (40 for a change,
  `SOS_MODULE_MAX_TURNS` 150 for a module build) is the only bound. (The KPI
  tile and the batch bars that said "no caps set" and "stops itself past"
  left the board on 2026-09-20; the admin page carries the spend.) The live instance had SOS_MAX_RUN_USD=1.50 and SOS_MONTHLY_CAP_USD=25
  as Railway variables; they must be removed or set to 0 AFTER this code is
  deployed (the old code read 0 as a zero-dollar cap).
- **Pending feedback on the board**: `act()` marks the card (greyed, spinner
  line naming the action) and a header pill until the server answers, then
  reloads. Runs in flight show the pulsing step as before.
- **Run diagnostics**: when the agent process dies, the run log gets a `diag`
  entry (model, message count, whether init was seen, stderr tail, prompt
  sizes) and the error says at what stage it died.
- **Module library and tours** (the Library tab of `/admin`,
  `registry.libraryModules`, `libraryView` in `src/feedback.js`,
  `registry.tourFor`, `GET /api/c/<slug>/modules/<m>/tour`): every SEPARATE
  module once, then the instances of it (Brendan, 2026-09-21). Two kinds of
  entry in `overview.library`. `origin: "repo"`: the repo's `modules/*` with
  description (module.json `description`), screens, migrations, smoke checks,
  tour; its `instances` are the companies that have it (live version, staged
  version, how many versions and how many built there, last change, Open and
  Start tour links), and the card can add it to a company that lacks it (the
  same `POST /api/admin/companies/<slug>/modules` as the company's own Modules
  section). `origin: "company"`: a module a company made through module
  creation; it has no repo copy, so it is an entry of its own (`key`
  `<company>/<name>`, `made_at`), what it is comes from the module.json and
  tour.json of the version on the floor (else the staged one, else v1), and it
  has one instance. Two companies that each made a module with the same slug
  are two entries, never merged; a name that is in the repo library always
  belongs to the repo entry. There is no way yet to copy a company-made module
  to another company or to promote it into the repo library; the card only
  shows it. `deployed` is kept on each entry for older callers. Start tour link
  (`/c/<slug>/m/<m>/?tour=1`). The tour engine lives in
  `public/assets/feedback-widget.js`: steps from the module's `tour.json`
  (the live version's copy if it has one, else the library copy), state in
  sessionStorage so it follows across the module's pages, spotlight ring on
  the target selector, centered card when the target is not on screen.
  PRINCIPLES.md rule 8 tells agents to keep tour.json current.
- **Repo imports no longer supersede agent work**: a changed repo module is
  imported as a new version but deploys automatically only if the live
  version is itself repo-sourced. Otherwise it is held (`module_import_held`
  event, "FROM REPO, NOT LIVE" tag in the Versions panel) and the manager
  can Switch to it. The old "export live first" advice still applies when
  the intent is to carry agent changes into the repo copy.
- **Reviews on the board**: only reviews with held items (or running, or
  failed within the hour) stay above the columns; past ones sit under "Past
  system reviews" in the Versions panel. "Build by screen" starts one queued
  run per target file for a review's held items (`buildReviewByScreen`).
- **Module build from a confirmed design** (2026-09-17, `src/modulebuild.js`,
  lane `module` in `build_runs`): Approve build on the design gate calls
  `modulebuild.startBuild(intake)`: a `platform.modules` row with no live
  version, v1 written from a **skeleton** the platform generates from the
  design (`skeleton()`: one `items` table with the thing's stages, seed rows
  from the first attached spreadsheet, a board screen with a move button per
  item, `/api/items` and `/api/stats`, a four-step tour), the design's
  `reference_md` as the module's `reference.md` doc, an approved proposal on
  the request feedback, and a run (`from_version` NULL, `to_version` 1,
  `requirement` = the reference, `evidence.intake_id`). `pipeline.advance`
  delegates the module lane here; deploy, cancel, retry, fix and override
  are the pipeline's own with two hooks (`afterDeploy`: intake and card
  done; `afterCancel`: a module that never went live is deleted again and
  the intake goes back to `confirmed`, where the card offers "Build it now",
  `POST /api/intakes/:id/build`). Build step: the agent (the intake model,
  Fable) works on the skeleton with `principles/MODULE-CONTRACT.md` (the
  files, manifest, routes signature and ctx services, migration rules and
  their two traps, base computed from location.pathname, tour shape) and
  PLAIN-WORDS.md in the system prompt, the design and the manager's own
  answers and starting rows in the user prompt (`NEW MODULE BUILD` header;
  fake mode leaves the skeleton and stamps the page). Then platform checks
  with no tokens (`validateModule`: manifest name and pages, migrations
  through the validator, routes.js loads and returns a router, tour.json,
  no hard-coded module address, no dashes); a failure is filed as a failed
  cross-check by "platform checks" so fix / retry / cancel apply. Then
  stage, cross-check (Fable, the design as the requirement, the file listing
  in diff shape from `listingAsDiff`), smoke, deploy gate ("Put it on the
  floor" on the request card, which shows `runBlock` like any card). Retry
  rewrites the skeleton; fix keeps the files. The strip shows a module with
  no live version as "being built" with only its Preview link.
- **Checks campaign** (2026-09-17 evening, docs/CHECKS-CAMPAIGN.md): Brendan
  reported functionality changes still stopped almost every time after the
  brief rewrite. Two findings and one tool. (1) The migration validator's
  forbidden-word check was a SUBSTRING match, so `updated_at`, `deleted_at`,
  `owner_name`, `granted_at`, `reset_count`, `rule_text`, `trigger_level`,
  `copy_count` and any seed text with "do" or "update" in it killed the build
  at the build step ("migration rejected"), which is what most functionality
  changes carry. Now whole words with string literals blanked out, and a word
  followed by a column type is a column (`src/migrate.js`, test cases in the
  commit). The `last_at` workaround in the kpis module is no longer needed.
  (2) Stops have five different causes and the board showed them all the
  same; `src/checks.js reasonFor` names them. (3) The checks log at
  `/c/<slug>/checks` (manager; "Checks log" on the admin company card since
  2026-09-20, before that in the board header): every run
  with its reason, the reviewer's findings and quoted evidence, and Right /
  Wrong / Unsure labels with a note in `platform.check_labels`; "Download
  the checks log" exports cases with before/after files
  (`GET /api/c/<slug>/checks/export[?labeled=1]`), and
  `scripts/replay-crosscheck.js` rebuilds each diff and runs the CURRENT
  brief (`pipeline.crossCheckCall`, a pure function now) through the API,
  printing old verdict, new verdict and agreement with the label. Tune the
  brief against labeled cases offline, not against live builds. Exit bar for
  a pilot is in the campaign doc.
- **Checks campaign, first export** (2026-09-17, docs/CHECKS-CAMPAIGN.md
  "First export"): five reviewer stops on the demo company, all Opus 5 on
  functionality changes; two right, three wrong or half wrong. Fixes: the
  build diff is `diff -ruN` (a NEW file's whole body shows; `-u` alone
  printed "Only in ...: 002.sql" and the reviewer failed the migration as
  unverifiable, run #28); the reviewer's brief carries GUARDRAILS.md only
  (PRINCIPLES.md made it fail builds for rule 9, run #31); `demote()` in
  pipeline.js turns blocking findings that are guesses ("if the underlying",
  "cannot confirm", "presumably"), housekeeping (data-changed, tour.json,
  reference.md) or cosmetic into minor with `demoted` recorded; an empty
  diff is a plain "the agent changed nothing" stop before the reviewer (run
  #32). Replay from the checks page: `POST /api/runs/:id/replay {model}`
  (`checks.replayRun`, diff rebuilt from stored versions by `diffForRun`,
  result in `platform.check_replays`, spend as ai_usage kind `replay`);
  the page shows each replay under the run with match/disagree against the
  label and "Replay every labeled case". `reasonFor` now says "deployed over
  a reviewer stop" / "cancelled after a reviewer stop" so overridden stops
  still count (`reviewer_failed`). Instance default review model set to
  Fable on Railway (`SOS_MODEL_REVIEW`); companies can still override on
  their Agent settings page.
- **Cross-check calibrated** (2026-09-17, `crossCheckSystem` in pipeline.js):
  the old brief ("fail anything beyond the requirement") never told the
  reviewer what a functionality change legitimately touches, so routes.js
  edits, new migrations and tour.json upkeep were read as violations and
  almost every functionality change failed. The brief now lists the five
  blocking conditions (requirement not met or on the wrong screen; a change
  the floor would notice beyond the ask; an existing migration edited or
  forbidden SQL; something plainly broken; a guardrail broken) and says what
  is never a violation (supporting code, new additive migrations, tour and
  reference upkeep, data-changed marks, tidy-ups, "what stays the same" is
  about behavior not files, anything unverifiable from a diff). The schema
  returns `findings` with severity and quoted evidence; the verdict is
  computed from the findings (fail only on a blocking one), never taken from
  the model's mood. The reviewer sees the lane, the target files and the
  files touched; the diff limit is `SOS_CROSS_CHECK_DIFF_CHARS` (90000) and
  a cut diff is declared as such. PRINCIPLES.md and GUARDRAILS.md ride along.
- **Module gate** (2026-09-18, `src/modulegate.js`, item 1 of the product
  review's build order). Found in the review: `registry.buildRouter` and
  `modulebuild.validateModule` load a module's routes.js into the platform's
  own process, so agent-written code ran with `process.env`, the disk, the
  network and every schema in reach (a probe module passed the platform
  checks while writing DATABASE_URL, SESSION_SECRET and the API key to a
  file), and the UI lane's "do not touch routes.js" was a line in a prompt
  with no reviewer behind it. The gate is a no-token check of a version's
  FILES that runs before anything loads them. Server files (every `.js` in
  the module, read by a small scanner that blanks comments, strings,
  templates and regex literals): only `require("./own-file.js")`; no
  `process`, `global`, `globalThis`, `eval`, `Function`, `import`, `fetch`
  and friends; no `sendFile` / `static` / `download` / `render`; no
  `.constructor` / `__proto__`; no SQL naming `platform.`, another module's
  schema, `information_schema`, `pg_` server functions, `search_path`,
  `SET ROLE`, `COPY`, `GRANT`, or CREATE / ALTER / DROP / TRUNCATE at run
  time. Layout: no package.json, node_modules, native or wasm files, links;
  `entry` stays a .js file inside the module. Lane: in a UI build only
  `pages/`, `tour.json`, `reference.md` and the labels, title and description
  of module.json may differ from the version the build started from; in any
  lane an existing migration is never edited or removed. A finding already
  present word for word in the from-version is "inherited" and does not stop
  the build (`evidence.gate.inherited`). Where it runs: `pipeline.advance`
  right after the agent finishes and BEFORE `stageVersion` (staging executes
  the code); `modulebuild.advance` before `validateModule`, and inside
  `validateModule` itself; and as a backstop in `registry.stageVersion`,
  `deployVersion` and `goToVersion` (`assertGate`), because the Versions
  panel can switch to any stored version, including a refused draft that a
  retry left behind. A version that was ever live (events
  `version_deployed` / `version_switched` / `module_imported`) is let
  through, so a rollback is never refused, and boot never refuses what is on
  the floor: it logs `[gate] ... is on the floor with code a new build would
  be refused for` instead. A stop is filed like the other platform checks
  (`step cross_check`, `cross_check.model = "platform checks"`, plus
  `evidence.gate`), the draft's text is persisted but never staged, the
  board says "The platform's own checks stopped it" with fix, retry and
  cancel and NO override or preview link (`pipeline.override` refuses
  platform checks), and the checks log counts it as "module gate". Fix
  round: the platform itself puts back the files a lane rule protects
  (`gate.restoreLaneFiles`, logged as "the platform put back: ..."), since a
  new agent session cannot know what they looked like, and the agent gets
  `gate.forAgent` wording instead of the reviewer wrapper. GUARDRAILS.md,
  MODULE-CONTRACT.md and the UI build prompt state the rules so builders do
  not trip them. Fake mode: GATECHECK in the feedback (or in a new module's
  name) makes the first attempt trip the gate and the fix round clear it.
  Tests: `node scripts/test-modulegate.js` (no database; also proves the
  library modules and the skeleton pass) and TEST-CAMPAIGN S0-74 to S0-80,
  S3-03a. **It is not a security boundary**: any text check can be got
  around. It stops the careless build and the lazily steered one; the wall is
  the process and database boundary (option C, built 2026-09-20, see "Module
  code runs in a process of its own"). The gate still runs first, so a build
  that trips a rule is refused before it is ever loaded, in either world. Still open from the
  same review, NOT covered by the gate: agent-written PAGES run in the
  manager's browser with the manager's session, so a staged preview could
  call the platform's own APIs (approve, deploy) as the manager; the fix is
  a Content-Security-Policy on module pages (`connect-src` and `form-action`
  limited to the module's own base path and the widget's endpoints). **Built
  2026-09-19, see the next bullet.**
- **Module pages are locked to their own module in the browser** (2026-09-19,
  `registry.lockDown` / `modulePagePolicy`, the page half of the 2026-09-18
  review's item 1). A module's pages are agent-written and open in the
  manager's browser with the manager's session, same origin as the board, so a
  staged preview could call the platform's own controls (approve, deploy) as
  the manager and walk around the structural gate. Everything served under a
  module mount now carries a Content-Security-Policy: `connect-src` and
  `form-action` limited to the module's own live and staged paths plus
  `/api/feedback`, `/api/c/<company>/modules/<module>/` and
  `/api/c/<company>/who` (the widget's endpoints: feedback, tours, the name
  picker); `frame-src`/`worker-src`/`object-src` none; no popups usable as a
  scriptable same-origin window. It is set on BOTH the pages the platform
  serves and whatever the module's routes answer: `lockDown` wraps the
  response so module code cannot drop or widen `Content-Security-Policy` /
  `Service-Worker-Allowed` (and the gate refuses code that tries, rules
  `header-policy`, `call-removeHeader`). The module gate also has page rules
  now (`checkPageFile`, `PAGE_RULES`): a screen naming `/api/admin`,
  `/api/proposals`, `/api/intakes` or `/api/c/`, opening a popup, framing
  another page, installing a worker, or loading anything from off the platform
  is stopped at build time with a plain reason. Proven in a real headless
  browser (`scripts/../browser-csp*.js` in the test run): the paperline and
  kpis pages, their charts, the chat and the staged amber bar all run clean,
  while a page trying to fetch the board, a deploy API, an admin API or a
  service worker is blocked by the browser. Not a wall on its own (a link off
  the page still navigates); the origin-per-module split is the real fix.
- **A never-approved draft cannot be switched onto the floor** (2026-09-19,
  `registry.goToVersion` + `wasEverLive`, the Versions panel). A build draft
  the agent wrote that never reached the floor (a check stopped it, or it was
  cancelled at the gate) can only go live through its own build's deploy gate;
  the panel marks it "NEVER APPROVED" and disables Switch, and `goToVersion`
  refuses it server-side. A version that was ever live (deploy, switch, import
  event, a deployed run, or a data snapshot) is always switchable, so rollback
  is never blocked. This closes the one path left open when the module gate
  went in: the gate stopped switching to a gate-refused draft; this stops
  switching to a reviewer-refused one too.
- **One company per session, per-company passwords** (2026-09-19, `src/auth.js`
  rewrite, trade study option B). Found in the review: the login cookie carried
  a role and no company, so any authenticated login reached every `/c/<slug>/`.
  Now the signed cookie carries role, company, a password generation and the
  issue time. `auth.companyGuard` (mounted in server.js right after
  `auth.middleware`) is the one gate: a `/c/<slug>/` or `/api/c/<slug>/` path
  must match the session's company, and an id-addressed route (`/api/feedback/:id`,
  `/api/proposals/:id`, `/api/runs/:id`, `/api/intakes/:id`,
  `/api/attachments/:id`) is looked up and must belong to it; admin passes
  everywhere; a floor or manager landing on `/` goes to its own board. The two
  body-addressed routes (`/api/feedback`, `/api/runs/batch`) scope themselves.
  Passwords: each company has its own floor and manager passwords, scrypt
  hashes in `platform.company_access` (never in `platform.companies`, which is
  read with SELECT * and handed to pages), set on the admin page (typed, or
  the platform makes up word-word-number ones and shows them once). A company
  made from the admin page gets its own at birth. `SOS_FLOOR_PASSWORD` /
  `SOS_MANAGER_PASSWORD` are now only a fallback: they open a company solely
  while its access row is `legacy_login=true`, which `ensureAccessRows()` sets
  at boot for companies that predate this change, until the admin gives them
  their own. Changing a password raises the company's `generation` and signs
  its people out. `SOS_ADMIN_PASSWORD` is unchanged (manager password doubles
  as admin when unset). Cookies from before this change (no company) are
  rejected, so everyone signs in once after the deploy.
- **Named admin accounts with an authenticator app** (2026-09-21,
  `src/accounts.js`, `src/totp.js`, the admin half of `src/auth.js`; scoped in
  the project file `claude/auth-2fa-and-network-access.md`). Until this, admin
  was one shared password, its cookie carried no generation and was never
  re-checked (an admin session could not be ended without rotating
  `SESSION_SECRET`, which signs out every plant), and the second gate on
  delete and restore was the same password typed again. Now admin is a personal
  login: `platform.accounts` (login = an email address, scrypt hash,
  `generation`, `status`, `failed_count`, `locked_until`; `role` is only
  `admin` for now and `company` is NULL, the shape managers inherit later),
  `platform.account_factors` (the TOTP secret, AES-256-GCM under
  `SOS_CONNECTION_KEY` through `connections.encrypt`, `verified_at`,
  `last_step`), `platform.account_recovery_codes` (ten, single use, sha256
  of an 80 bit code, shown once), `platform.auth_events` (who tried what from
  where; kept `SOS_AUTH_EVENT_DAYS` = 400 days, shown on /admin under
  "Sign-in log"). The tables are made by `accounts.init()` like every other
  platform table (NOT `src/migrate.js`, which is module migrations only).
  **Login**: the login page has a quiet "Anetix staff sign in" link (it opens
  by itself when the link that brought you was /admin) that shows a name box.
  A name means the account path, no name means the company password path,
  which is untouched. `POST /login {name, password}` answers `{need_code:
  true}` with no cookie when the account has an authenticator; the page shows
  the 6 digit box and sends name, password and code together (no server-side
  pending state). `src/totp.js`: RFC 6238, HMAC-SHA1, 30 s, 6 digits, steps
  -1/0/+1, constant time, vectors runnable with `node src/totp.js`. A code is
  CLAIMED with one `UPDATE ... SET last_step=$2 WHERE last_step < $2`; zero
  rows is a replay and is refused, so the same code never works twice and the
  code that signed you in does not count as a step-up. A recovery code is
  taken in place of the app's code. Five wrong passwords or codes lock the
  account for fifteen minutes (`SOS_ACCOUNT_MAX_FAILS`, `SOS_ACCOUNT_LOCK_MIN`),
  on top of the per-address throttle; an unknown name gets the same words, the
  same scrypt work and the same lock (in memory), so neither the answer nor
  the lock says which names exist. **Session**: still five parts so plant
  cookies survived the deploy; an admin cookie is `admin.*<account
  id>.<account generation>.<time>.<mac>` (`auth.signAdmin`), `verify` parses
  the id and still answers company `*`, the middleware sets `req.sosAccount =
  { id, login, name, enrolled }` and checks the account's generation and
  status on every request (ten second cache, `accounts.sessionState`), which is
  the revocation admin never had. Lifetimes slide since 2026-09-24 (see
  "Sliding sessions and trusted admin devices": `SOS_ADMIN_IDLE_HOURS` 168 /
  `SOS_ADMIN_CAP_HOURS` 720; `SOS_ADMIN_SESSION_HOURS` is no longer read). The
  old admin cookie (`admin.*.0...`) no longer verifies. An account with NO authenticator signs in with its password
  and reaches `auth.ENROLL_PATHS` only (the admin page, which shows the setup
  and nothing else, who-am-I and the two enroll calls); everything else is 403
  `enroll_required` or a redirect to /admin. **Enrollment** on /admin: a 20
  byte secret, `otpauth://totp/Anetix%20SOS:<login>?secret=..&issuer=..` drawn
  by `src/qrcode.js` plus the base32 text, one good code before `verified_at`
  is set, then the ten recovery codes once (copy, download). Refused while
  `SOS_CONNECTION_KEY` is unset (the fallback key is `SESSION_SECRET`, and
  rotating that would make every secret unreadable). **The accounts card** on
  /admin: add (the platform makes up a first password, shown once; the person
  changes it with "Change my password", which signs them out everywhere),
  switch off / on, sign out everywhere (generation + 1), reset authenticator,
  new password. Making an account, switching one on, and resetting a factor or
  a password need a fresh code from the person doing it; switching off and
  signing out do not (they are what you press when something is wrong). An
  account cannot switch itself off. **Remove** (2026-09-21, the same evening:
  a name typed wrong had no way out): `POST /api/admin/accounts/:id/remove`,
  only an account that is already switched off, never your own, a fresh code;
  the row goes and the factor and recovery codes cascade with it; the sign-in
  log keeps its lines under the old id and login and adds `account_removed`
  with who did it. The Remove button sits next to Switch on. Routes: `/api/admin/accounts*`
  (`accounts.router`, mounted before the platform router; the platform's
  internal token is refused there). **Step-up**: `auth.checkAdminCode(req,
  { code, password }, what)` replaced `checkAdminPassword` at company delete
  and restore; admin.html asks for the code. **The shared admin password**
  (`SOS_ADMIN_PASSWORD`, else the manager password) opens admin ONLY while no
  active admin account has an authenticator that decrypts
  (`accounts.legacyOpen`): that is how the first accounts are made, every use
  is logged `legacy_admin_password`, its session is account 0 and dies within
  ten seconds of the first enrollment, and after that it is refused with the
  ordinary "wrong password" (logged `legacy_admin_refused`). Then take the
  variable out of Railway; with it gone the shared MANAGER password goes back
  to being a manager of a `legacy_login` company (e2e mode `noadminvar`). A
  factor that cannot be decrypted (a backup restored under another key) does
  not count, so a restore to a fresh instance does not lock everyone out.
  **Break glass**: `SOS_ADMIN_2FA=off` lets an account in with its password
  alone (and a step-up takes that password), logged `break_glass` every time,
  shouted at boot and on /admin. It needs Railway, which is behind 2FA.
  **Backup**: `accounts`, `account_factors` and `account_recovery_codes`
  travel in the file (hashes and encrypted secrets; the recovery codes had to
  come too or a restore would leave one account's codes under another's id);
  `auth_events` never does. A restore leaves every generation above both the
  file's and the instance's, so a session signed out after the backup stays
  dead and every admin signs in again; a file from before accounts leaves the
  instance's accounts alone. **Module code's database logins** have no rights
  on the platform schema, so none on these tables (checked in the e2e).
  Units: `node src/totp.js`, `scripts/test-accounts.js`. End to end:
  `scripts/e2e/accounts.js` (90; plus modes `restore` 11, `breakglass` 9,
  `noadminvar` 6, commands in its header) and `accounts-browser.js` (26,
  playwright; the QR was also decoded from a screenshot and matched the key).
  Known limits: a per-account lock lets anyone who knows an admin's email keep
  that account locked (the named fix is the edge check below plus Cloudflare
  rate limiting; the lock clears itself in fifteen minutes and "Switch on"
  clears it at once); TOTP is not phishing resistant (passkeys later, and a
  passkey is bound to the domain it was made on); `OPEN` (no password
  variables at all) still makes every request admin, so never take ALL of
  `SOS_FLOOR_PASSWORD`, `SOS_MANAGER_PASSWORD` and `SOS_ADMIN_PASSWORD` out of
  Railway at once. Admin actions in the interaction record still say "Anetix",
  not the account's name (a floor-facing wording choice, left for Brendan).
- **Requests must come through Cloudflare** (2026-09-21, `src/edge.js`,
  first middleware in server.js). Railway's edge routes by host name, so a
  request sent straight to it with `Host: sos.finnoperations.com` skipped
  Cloudflare and could carry any `CF-Connecting-IP`, which is what the login
  throttle keyed on. (1) `SOS_EDGE_SECRET`: a Cloudflare request-header
  Transform Rule adds `X-SOS-Edge: <the same value>`; with the variable set,
  anything without it gets 403, apart from `/health` (Railway's health check)
  and loopback (the platform's own calls to a staged build). `SOS_EDGE_MODE=
  report` refuses nothing and counts, and the accounts card on /admin says
  whether THIS request carried the header, so the rule is proven before it can
  lock every plant out. Unset: no check. (2) `edge.clientIp(req)` is the one
  place an address is read (`auth.clientIp` is it): a request that carried the
  secret believes `CF-Connecting-IP`; otherwise `X-Real-IP` (set by Railway's
  edge) is the client unless it is one of Cloudflare's published ranges
  (`net.BlockList`, the 15 + 7 ranges checked 2026-09-21, `SOS_CF_RANGES`
  overrides); with no Railway edge in front it reads as before. Never
  `X-Forwarded-For`. Unit: `scripts/test-edge.js`. **Live since 2026-09-21,
  enforced**: the side door was real (a curl straight at the Railway edge
  answered 200 from `railway-hikari` with no `cf-ray`), the Cloudflare rule is
  "Request Header Transform Rule", hostname equals `sos.finnoperations.com`,
  Set static `X-SOS-Edge`; it was proven in report mode first (the 11 requests
  without the header were one page load in the seconds before the rule
  reached Cloudflare's edge), then `SOS_EDGE_MODE` came out and the same curl
  against `/login` answers 403 (`[edge] refused` in the deploy log). Test the
  gate against `/login`, never `/health`, which is exempt and answers 200
  forever. A variable change on Railway takes about two minutes to serve: the
  old container answers until the new one passes its health check. Seen the
  same day: Railway fills `X-Real-IP` with the VISITOR's address for requests
  that came through Cloudflare, so the range check never matches there and
  the secret is the whole gate; rotating it means changing the Cloudflare rule
  and `SOS_EDGE_SECRET` together, with `SOS_EDGE_MODE=report` set while the
  two disagree.
- **Sliding sessions and trusted admin devices** (2026-09-24, `src/auth.js`
  sign / verify / reissue, `src/people.js`, `src/devices.js`, the code step of
  `public/login.html`, the Accounts tab; the project file
  `claude/sessions-and-trusted-devices-2026-09-24.md` has the live run and the
  status table). Why: every cookie died a fixed time after sign-in (admin 12 h,
  person 12 h, device 30 days), so an admin typed password and code most
  mornings and a name and PIN typed at 6am were gone at 6pm whatever the person
  was doing; Railway's request log showed one admin sign-in per working day
  and nothing else killing cookies. **Sliding windows**: a cookie carries
  `issued` (the sign-in) and `refreshed`; it is good while the generation
  matches, now minus refreshed is under the IDLE window, now minus issued is
  under the CAP, and neither time is in the future. Any request that verifies
  once more than half the idle window has passed since the last refresh gets
  the cookie again (`auth.reissue`, `res.append("Set-Cookie")`: same
  attributes, Max-Age = the idle window or what is left of the cap). Windows in
  HOURS, so a deployment that has to meet AAL2 on paper sets 1 and 24 with no
  code change: admin `SOS_ADMIN_IDLE_HOURS` 168 / `SOS_ADMIN_CAP_HOURS` 720;
  floor and manager `SOS_SESSION_IDLE_HOURS` 720 / `SOS_SESSION_CAP_HOURS` 4320
  (0 = no cap, revocation by company generation only); person
  `SOS_PERSON_IDLE_HOURS` 168 / `SOS_PERSON_CAP_HOURS` 720. `SOS_ADMIN_SESSION_HOURS`,
  `SOS_SESSION_DAYS` and `SOS_PERSON_HOURS` are no longer read (boot warns if
  set). The cookie shapes grew one part (session six, person seven); the old
  one-time shapes are accepted while their one time is inside both windows and
  come back in the new shape on the first request seen, so the deploy signed
  nobody out. On a shared tablet a name now stays for days, so the name is
  shown wherever a person acts: the feedback button itself reads "Feedback ·
  Maria G", the panel "Sending as Maria G · not you?", the board chip.
  **Approvals stay fresh**: `SOS_APPROVAL_PIN_HOURS` (12; 0 = off). A signed-in
  name whose PIN was typed longer ago than that is asked for it again on the
  approval itself (`people.requireFreshPin` on decide, batch, confirm, deploy,
  override, retire-check, rollback, goto, and a new module's confirm and
  build): the route answers 401 `{ pin_again, person }`, the board's `act()`
  opens the PIN pad for that name (`window.sosPerson.pin(person, done, why)`)
  and sends the action again; nobody signed in passes, the device's login
  decides as before. Feedback attribution stays loose. **Trusted admin
  devices** (`src/devices.js`, `platform.admin_devices`: id, account_id,
  token_hash = sha256 of a random 32 byte token, label from the user agent
  ("Safari on macOS"), issued_at, last_used_at, expires_at = issued plus
  `SOS_TRUSTED_DEVICE_DAYS` 30 (absolute, not sliding), generation at issue,
  removed_at). "Remember this computer for 30 days" is a box on the CODE step
  of the staff sign-in and nowhere else (a recovery-code sign-in never shows
  it and the server never mints on one). Ticked, once the app's code is
  accepted the platform sets cookie `sos_admin_device` = `<id>.<token>`:
  HttpOnly, Secure, SameSite=Lax, `Path=/login` (the one route the form posts
  to, so no page ever sees it), Max-Age 30 days. At the next sign-in from that
  browser, when the password matches an enrolled account
  (`accounts.signIn({ device, remember, ua })`): the row by id, the hash
  compared in constant time, not removed, not expired, account switched on,
  generation equal to the account's current one; all true, the admin session
  is issued with no code step and the log says `signin_trusted_device` with the
  device id (`last_used_at` set). Anything false: the code step as always,
  `device_refused` with why, and the cookie cleared when the row is expired,
  removed, gone or the generation has moved (a wrong token is left alone).
  What a trusted device NEVER skips: the fresh code on company delete, backup
  restore, add account, switch on, new password, remove, reset authenticator
  (`stepUp` is untouched); break glass `SOS_ADMIN_2FA=off` is unchanged; a
  wrong password from a trusted browser counts toward the 5 in 15 minutes lock
  like any other. Keeping them: Accounts tab, "Computers that skip the code"
  under My account (`GET /api/admin/accounts/me/devices`, label, since, last
  used, Remove = `POST .../devices/:id/remove`, own account only, no code: it
  only tightens); the accounts table says "N trusted computers" per account.
  Sign out everywhere raises the generation, so every device row of the
  account stops matching and drops off the list; reset authenticator deletes
  the account's rows (new factor, trust again); switch off refuses them while
  the account is off; ten per account, the eleventh removes the oldest;
  removing an account cascades. `admin_devices` never travels in the backup
  (`NOT_IN_BACKUP`) and a restore truncates it (and raises generations anyway).
  The honest cost, for the customer-facing wording too: a computer holding
  both cookies is an admin for up to 30 days without a code, the trade GitHub
  and Google make; both admin Macs need FileVault and a lock-screen timeout,
  and Sign out everywhere is the kill switch. Units: `scripts/test-accounts.js`
  (48: refresh past half idle, none before, idle and cap expiry, future times,
  old shape accepted and re-issued, the retired variables),
  `scripts/test-people.js` (34: the same for the person cookie, and the fresh
  PIN rule), `scripts/test-devices.js` (25: the cookie shape, constant-time
  compare, expiry, generation, removed, account off, the cap of ten, labels).
  End to end: `scripts/e2e/accounts.js` (145; restore 13, breakglass 9,
  noadminvar 6) and `accounts-browser.js` (37: the box on the code step, gone
  in recovery mode, the list, Remove, a sign-in that skips the code).
  `scripts/e2e/run-all.sh` runs every suite on the database it asks for.
  Known limits: a device cookie is a bearer token on the sign-in route (a
  stolen one is a sign-in until Sign out everywhere or 30 days); the label is
  from the user agent, so two Safaris on two Macs read alike (last used tells
  them apart); passkeys wait for the Anetix domain (a passkey is bound to its
  domain).
- **Requests to Anetix** (2026-09-24, `src/requests.js`, the Requests tab of
  `/admin`, the "Requests to Anetix" strip on the board, My requests on the
  feedback button; Brendan: a clear place to see the feedback from the CI
  boards, make it plain that it goes to him, and two-way communication so the
  person sees where it is while it is being addressed). Feedback about the
  software itself (module `platform`: the board, the settings pages, the admin
  page) is not built by the in-app agent; until this a manager could read one
  company's at `GET /api/c/<slug>/feedback/platform` and nothing went back to
  the person who sent it. Now: columns on `platform.feedback` `anetix_stage`
  (NULL = received, `looking`, `working`), `anetix_note` (the last word back),
  `anetix_at`, `anetix_by`; `requests.stateOf` (pure) is the one line everyone
  reads ("Sent to Anetix, the people who make this software. Nobody has looked
  yet." / "Anetix is looking at it. Brendan says: ..." / "Anetix is working on
  it." / "Fixed by Anetix. <what changed>" / "Anetix is not doing this one.
  <why>"; the manager's own Decline on the strip reads "Declined by the
  manager."). Routes, admin only, on the `/api/admin` path space a module
  page's policy does not open: `GET /api/admin/requests?status=open|closed|all`
  (every company, newest first, with `open` and `untouched` counts),
  `POST /api/admin/requests/:id { stage, note }` (a stage on a closed one
  reopens it), `POST /api/admin/requests/:id/close { answer: fixed | not_doing,
  what }` (words required; the earlier note goes, the words are the last word
  back). Record kinds: `anetix_stage`, `feedback_closed` with
  `detail.by_anetix`. **The Requests tab**: open ones first with a NEW mark and
  an amber edge while nobody has looked, buttons Looking at it / Working on it
  / A word back / Fixed / Not doing this, closed ones folded; a header pill
  "Requests: N open, M new" (amber while any is untouched) and the tab badge
  count. **The board**: the strip is "Requests to Anetix" with the hint saying
  they go to Brendan, each card chip reads TO ANETIX and carries the stage line
  and note; Decline stays for the manager. **The floor**: the feedback panel on
  a platform page says "this goes to Brendan at Anetix, who makes it, not to
  your manager" before the person types, and "Sent to Anetix. You can follow
  it under My requests." after; My requests shows "the software itself, to
  Anetix", the stage line in its color and the word back; a quiet navy
  "Anetix answered" badge sits on the My requests link until the person opens
  the list (`localStorage sos.anetix.<co>` = request id to the `answered_at`
  seen). `closeloop.mayAnswer` is false for platform rows (no "did it fix
  it?"), `publicRow` adds `to_anetix`, `note`, `answered_at`, `answered_by`.
  Tests: `scripts/e2e/requests.js` (32) and `requests-browser.js` (18, also
  the folds that stay open and the board icon per company). Same push, two
  board fixes: (1) "See the full requirement" and "what the check saw" folded
  themselves shut on the 4 s redraw within seconds of being opened
  (`OPEN_FOLDS` and `fold(key, summary, body)` in `index.html`, the pattern
  `OPEN_MORE` already used); (2) every board's tab icon showed one company's
  mark: `index.html` carried a hard-coded `<link rel="icon"
  href="/api/c/demo/icon">`, which the browser fetches at parse time and
  Safari keeps for the page whatever the script sets later. The file now says
  `/api/c/__company__/icon` and `server.js` serves `/c/:slug/` with the slug
  put in; `/api/c/:slug/icon` carries an ETag (304 on revalidation) and the
  board payload carries `icon_v` (a sha1 prefix of the icon), which the page
  appends as `?v=` so a browser that keys its icon cache by URL never shows
  one company's mark on another's board and a rebuilt guide shows at once.
- **The test floor** (2026-09-24, `src/testfloor.js`, the third lane in `src/dbroles.js`,
  `src/runner.js` and `src/registry.js`, `migrate.buildTestSchema`; concept and the
  interaction matrix in `docs/TEST-ENVIRONMENT.md`; Brendan: "the option to turn on
  a test environment so that they can run a full test campaign ... to test all
  interactions within the module and to other modules. Not all companies will have
  this"). **A switch per company, off by default, set by the admin**
  (`platform.companies.test_floor`, the "Test floor" section of the company card,
  `POST /api/admin/companies/<slug>/test-floor { on }`). With it off nothing shows
  anywhere and every older suite runs unchanged. **On**: every tool with a live
  version gets `tst_<company>_<tool>` tables BUILT FROM THE VERSION'S OWN MIGRATIONS
  on an empty schema (so serial columns have sequences of their own; the staging
  clone's `LIKE ... INCLUDING ALL` keeps the floor's, which is why staging leaves
  id gaps on the floor and the test floor never does) and filled from the floor's
  rows (columns in common) or a made-up set; a third database role
  `sos_<company>_tst` (`dbroles.TEST`, `ALL_LANES`; made when the switch first goes
  on, dropped with the company; rights on the company's `tst_` tables and nothing
  else, the hostile suite proves it misses `mod_`, `stg_`, another company and
  `platform`); a third child process (`runner.js` lane `test`, user id base + 2,
  `peersOf(company, "test", rec)` hands it the TEST schemas of the company's tools
  and the list of tools up in that process, so `ctx.peer("kpis")` on the test floor
  reads the test copy of kpis, never the floor; the live and staged children never
  learn a test schema); a mount `/c/<slug>/test/m/<tool>/` (`registry.mountTest` /
  `unmountTest` / `testMounted`, `mounts.<key>.test`, `attach`; an API path answers
  404 JSON `no test floor` when there is none); the browser policy's `connect-src`
  and `form-action` carry the test path; `screenFor`, the widget's `modBase()`,
  `connections.deviceCookie` and `pageload.sameProblem` know the third prefix, and
  `test` is a reserved module name. **Which version runs there**:
  `platform.modules.test_version` (NULL = the floor's version;
  `testfloor.effective(m)`); a deploy or switch moves a tool that is not under test
  (`registry.hooks.deployed` chains `testfloor.afterDeploy` before the diagrams:
  code remounted, missing migrations applied, data kept); a library module added to
  a company gets its test copy (`afterModuleAdded`); boot (`testfloor.boot()`,
  after `registry.loadAll`) mounts every company whose switch is on and rebuilds a
  schema that is missing (a restore drops `tst_` with the rest; they are never
  dumped). **Data sets** (`platform.test_floors`: `on`, `data_source` floor |
  made, `made_rows` `{ tool: { table: [rows] } }`, `made_note`, who, `built_at`,
  `reset_at`, `campaign_id`): `POST /api/c/<slug>/test-floor/reset { source?, rows?,
  note? }` (manager) rebuilds every tool from the source in force, or from the one
  given; a made-up set is checked against the real columns before anything is
  rebuilt (`migrate.rowsProblems`, 400 with the columns named; nothing changes) and
  capped at `SOS_CAMPAIGN_MAX_ROWS` (200) a table; a tool the set says nothing about
  is filled from the floor. `GET /api/c/<slug>/test-floor` is the status any device
  of the company reads (the settings page's card, the admin section). The version
  route takes `?lane=test` and answers `test_floor`, `test_version`,
  `test_built_at`, which is how an open test page reloads when the version moves or
  the data was put back, and leaves for the live page when the floor is switched
  off. **Off**: refused while a campaign is running; builds waiting at the campaign
  step go on to the deploy gate with a note (`campaign.releaseWaiting`); then the
  mounts, the test child, every `tst_` schema (the confirm says the data is thrown
  away), `test_version`; the `test_floors` row stays with `on=false` so a made-up
  set survives a round trip; campaign history stays. **What a person sees**: the
  strip's violet "Test floor" link per tool while on; a violet bar on every test
  page ("TEST FLOOR. Nothing here is real. The floor is on version N", with the
  version under test named, and the way back; no news banner, no "did it fix it?"
  there); the feedback panel says where they are and a card filed from a test page
  carries a "from the test floor" chip (the screen is resolved as on the floor);
  the settings page's "Test floor" card (a button per tool, the data in force, Put
  the data back); the admin company card's section (switch, tools up, data, Open,
  Put the data back). Connections on the test floor: a label printed there is a
  real label (the job row carries `lane: test`), an ERP lookup is a real read-only
  lookup, `ctx.ai` spends under the company's budget with `lane: test` on the
  usage and the record, spreadsheets upload to the floor only. Record kinds:
  test_floor_on, test_floor_off, test_floor_reset, test_floor_data. `test_floors`
  is in the backup and in company delete (`testfloor.deleteCompany` drops the
  schemas; the runner drops the third role). Tests: `scripts/e2e/testfloor.js`
  (43: off by default and nothing answers, on, one world and not the floor's, a
  sibling's peer read on the test floor, the deploy followed with data kept,
  reset, a made-up set and a refused one, off tears everything down, on again with
  the set intact, delete with a floor up), `testfloor-browser.js` (15: the bar,
  the strip, the settings card, the admin section, a page that leaves when the
  floor goes off), and `runner-hostile.js` gained 18 checks against the third lane.
  Sandbox note: the e2e database user has to be able to make roles (in this
  sandbox `ALTER USER sos WITH SUPERUSER`), or the runner falls back to inline and
  the hostile suite's own-table checks fail.
- **The test campaign** (2026-09-24, `src/campaign.js`, `platform.test_campaigns`;
  step `campaign` in every lane between the platform's checks and the deploy gate,
  present only when the company's test floor is on at the moment the build passes
  its checks: `pipeline.toGate` asks `campaign.begin(runId)` and goes to
  `await_deploy` when it answers false; `modulebuild` does the same; the board's
  `laneSteps(run)` draws the step only on a run that has one). Brendan: "also
  proposed test campaign by AI ... semi automated, this is if anything giving the
  user more confidence in the system so ideally they will do some of it and see
  the results that it is interacting properly". **The proposal** (`propose`, one
  structured call on `pipeline.modelForRun(run, "design")`, the run's A/B arm
  respected, `ai_usage` kind `campaign`, `maxTokens` 16000): the tool's files
  whole (`modulesource.sourceText`), the request words, the requirement or
  design, the plain summary, the diff against the floor (`diff -ruN`; a new
  module: the listing), the checks the tool already carries (not to repeat),
  the connections declared, and every sibling tool's screens, calls, smoke
  paths, its `reference.md` and the lines of its `routes.js` that call `peer(`
  (`siblingsBrief`, which also says which siblings READ the tool under test),
  plus the last campaign on the tool. Output (`SCHEMA_OUT`): title, summary,
  `data { source floor | made, why, made }`, 3 to 12 cases `{ id, title, why,
  area inside | across | connection | role, kind auto | guided, steps }`. **The
  case format** is a check (GUARDRAILS "Checks") with three additions: `module`
  on a step (a sibling tool; `acceptance.parse(name, text, { allowModule })` and
  `runCheck({ bases })` carry it, a check in a module's own files still may
  not), `do` steps for guided cases (`{ do, on, module?, then?, within }`: the
  person does it, the platform asks `then` every `SOS_CAMPAIGN_WATCH_MS` (5000)
  until it matches or `within` seconds pass, then the step is "seen"; no `then`
  = a plain tick), and nothing in it is a promise (cases live in the table,
  never in `checks/`, so the module gate has nothing to learn and no agent can
  write or retire one). `campaign.parse` (pure, on `acceptance.parse`) drops a
  case that is wrong with the reason (`dropped`), caps 12 cases and 4 guided,
  clamps `within` to 30..3600; titles and every `do` sentence go through
  `plainwords.scrub` (a rewrite on the short text model, then the check again; a
  line that still fails drops the case). **On the card** (status `proposed`, the
  run `waiting`): title, summary, "N cases, K you do yourself, M across tools",
  the cases folded with an area chip (THIS TOOL / ACROSS TOOLS / CONNECTION /
  WHO MAY / YOU DO) and a "run it" tick each, the data choice (a fresh copy of the
  floor's data, or the made-up set with its row counts), "Add a case in your own
  words" (a plain guided step on the first screen, ticked by hand), **Run the
  campaign on the test floor** (`POST /api/runs/:id/campaign/approve { cases,
  data, added }`, manager, fresh PIN) and under more Skip this campaign (`.../skip
  { reason }`, words required, a waiver on the record) and Cancel the build.
  **Preparing and running** (`execute`): `testfloor.setUnderTest(company, mod,
  to_version)` then `testfloor.reset` with the choice (so every tool's test tables
  are rebuilt, the tool under test from ITS version's migrations, the
  `test_floors.campaign_id` set), then the auto cases in order through
  `acceptance.runCheck` with `bases` = the test mounts only and the company's
  service cookies (a step naming a tool that is not up fails with a plain reason
  instead of reaching anywhere), page steps in the platform's browser when it has
  one; each case's result and a `campaign_case` record as it lands. A failed auto
  case does NOT end the campaign: the person still does their steps and sees the
  rest, and the verdict comes once everything is closed (`verdictOf`, pure).
  **Walking**: the run is `waiting`; the card lists the guided cases with "Open
  the test floor here" per step, the state (waiting for you / seen by the
  platform with what it saw / done by hand, not seen / not right with the words),
  Done and Not right (`POST /api/runs/:id/campaign/steps/:case/:n { answer done |
  not_right, what }`, manager; words required for not right); the test page's bar
  shows the steps for THAT screen (`GET /api/c/<slug>/who/campaign?module=&page=`,
  `stepsForScreen`, open to any device of the company through the page policy's
  `/who` allowance) with Done and Not right that post to `POST
  /api/c/<slug>/who/campaign/steps/<campaign>/<case>/<n>` under the signed-in
  person's name ("Done (Maria G)"); watches are evaluated by `tick` on every read
  of a walking campaign and by `startWatching`'s interval; a watch past `within`
  stops looking (`timed_out`) and the person's Done still closes the step. **The
  verdict** (`finish`): passed = every auto case ok and every guided step seen or
  done: `evidence.campaign = { id, status: "passed", line, attempt, counts,
  by_hand, seen }`, the run to `await_deploy`, the run log "test campaign passed:
  N cases, K steps seen by the platform and J done by hand (names); ready for the
  deploy gate", record `campaign_passed`. Failed (a case did not pass, or a person
  said not right): the run fails at step `campaign` with
  `evidence.campaign.failed = [{ id, title, kind, step | do + words + by }]`, the
  stopped card leads with the failed cases and the person's words, then Send
  findings back (`pipeline.fix` accepts the step; `campaign.forAgent` is the
  agent's brief, `findings_from: "campaign"`, the person's words verbatim) and
  under more Deploy anyway (`.../campaign/waive { reason }`, manager, fresh PIN,
  words required: `evidence.campaign.waived`, record `campaign_waived`, the
  shipped tile and the checks log say "deployed over a failed test campaign"),
  Retry from scratch, Cancel. **After a fix round** the checks run again and
  `begin` finds the failed campaign with its approved cases and runs the SAME
  campaign again (attempt + 1, no second approval, the guided steps done again;
  the card says so). Deploy, cancel, discard and retry call
  `campaign.afterRunEnds`, which closes an open campaign and puts the tool back on
  the floor's version of the test floor (`setUnderTest(..., null)`). The switch
  going off releases waiting builds (above). Boot sweeps a campaign that was
  proposing, preparing or running at the restart to failed. Loop health
  (`builds.campaigns`: proposed, approved, skipped, passed, failed, waived,
  steps_seen, steps_by_hand, steps_not_right, from the record; `stops.campaign`
  counted apart from gate, reviewer and tests so it never touches the quiet
  stretch; `runTimes.ready` reads the campaign's "ready for the deploy gate" line)
  and a "campaigns ..." line in the Health table's Shipped cell only where a
  company ran any; the checks log names "test campaign failed" and "deployed over
  a failed test campaign" and shows the campaign under the run;
  `checks.listChecks` rows carry `campaign`. The board payload carries
  `campaigns` by run id (`campaign.forBoard`) whenever the switch is on or a run
  carries one. Fake mode (`fakeProposal`): four cases (the first screen and the
  smoke list; a floor read; the first sibling's screen, across; one guided case
  on the first screen with a watch on the first smoke path, seen at once) and
  markers in the request words: `CAMPAIGNFAIL` (the second case expects 599 on
  the first attempt and passes from attempt 2), `CAMPAIGNMADE` (paperline: a
  made-up set of two open requests), `CAMPAIGNNOWATCH` (the guided step has no
  watch, so it waits for a tick). Tests: `scripts/test-campaign.js` (22, pure:
  the format, drops with reasons, the verdict, the steps a page shows, the fake
  proposal under the same rules), `scripts/e2e/campaign.js` (47: no step with the
  switch off; proposed, dropped and added cases, the made-up data on the test
  floor, a watch seen on its own, a floor person's tick from the test page, the
  pass and the gate, the tool back on the floor's version after deploy or
  discard, not right with words and the fix round rerunning the same campaign,
  deploy anyway, skip, the switch going off under a waiting build, loop health)
  and `campaign-browser.js` (19: the card in every state, the test page's step
  turning to Done under the person's name, the stopped card, Deploy anyway through
  the prompt, the shipped tile's line). `run-all.sh` runs both. Not yet: a
  campaign on the floor as it is (no build behind it), cases kept as promises
  after a pass, the floor's names on guided steps through a PIN (the signed-in
  person is recorded when there is one), a campaign across two tools' new
  versions; `docs/TEST-ENVIRONMENT.md` lists them. Read the first real campaigns
  before trusting the brief (the fake ones are machinery only).
- **The data wall** (2026-09-24, `src/datawall.js`, `agent.atWall`;
  `docs/DATA-WALL.md` has the table of every place data reached a model and
  what the wall does there; Brendan: "whether they have their AI looking at
  the data when it is building or it is walled off from the data ... only
  building the pipeline for the data to go through without ever seeing the
  data"). **A switch per company on the admin card** ("What the AI reads",
  `platform.companies.ai_reads_data`, default true, `POST
  /api/admin/companies/<slug>/data-wall { walled }`, admin only, record kinds
  `datawall_on` / `datawall_off`; `datawall.isWalled(company)` is cached ten
  seconds). **Walled off, no row reaches a model**: the files every reader
  gets (the proposer, the system review, diagrams, the campaign proposal, the
  head-to-head) go through `datawall.filesForModel`, which replaces each
  `INSERT` statement in a migration with a note (`withheldMigration`; CREATE
  and ALTER stay, so the columns are known); the build step withholds the
  same in the agent's folder before it starts and restores the originals byte
  for byte after (`withhold` / `restore`, `evidence.walled`, the run log
  "starting rows withheld from ..."); a new module's skeleton seeds nothing
  and declares a `files` connection `starting` that the PLATFORM loads from
  the manager's sheet after the first deploy (`modulebuild.afterDeploy`,
  record `starting_rows_loaded`); an intake's photos and pdfs are named and
  withheld and a sheet is its headers and row count
  (`attachments.blocksFor(id, { walled })`); photos with a request are off
  (`arrival.settings` answers `allow_photos: false`, the settings page says
  why, `POST /api/feedback` refuses the photo with the words going through);
  "point at it" sends the element's tag, id, classes and position only
  (`datawall.element`); the system review skips its live snapshot; check
  failures are quoted to the agent as paths and types, never values
  (`acceptance.match(actual, expected, at, hide)`, `runCheck({ hideValues })`);
  `ctx.ai.chat`, Jonah and any persona answer 409 with one plain sentence
  ("AI reading of the company's data is switched off for this company, so
  this helper cannot answer. Anetix can switch it on."); every walled prompt
  carries `datawall.PROMPT_NOTE`. **Outside the wall by decision, no
  filter**: the words people type (feedback, intake answers, adjustments,
  "not right" on a campaign step) are the request and are accepted as shared
  with the AI. **The choke point**: `runAgent`, `runStructured` and `runChat`
  take `company` and call `agent.atWall(kind, {...})`, which drops image and
  document blocks for a walled company whatever the caller sent, and with
  `SOS_PROMPT_LOG` set appends every prompt as a JSON line, fake mode included
  (every fake branch calls it too, so the log is the same in both modes).
  NEVER set `SOS_PROMPT_LOG` on the live instance: it is the canary's tool
  and writes every prompt, data included, to a file. **The canary**:
  `scripts/e2e/datawall.js` (34) seeds `CANARY7731` into every kind of
  company data (a module built from an intake sheet so its migration carries
  it, a floor row, a stock upload, a pointed element, a photo), walls the
  company, runs every model flow (proposal, change build, broken promise and
  fix round, review, campaign, diagrams, intake and its module build, Jonah)
  and asserts the kinds all logged, no prompt carried the marker but the
  request words it was typed into on purpose, no image or document block went
  out, the migration was restored, the starting list was loaded by the
  platform; then the wall comes down and the marker returns. Unit:
  `scripts/test-datawall.js` (19). Known limits (in the doc's "Being honest"
  section): from now on, not retroactive; column names, page labels and a
  check's expected values are read; a sheet's shape goes through; staging
  and the test floor hold real rows (between the data and the model, not the
  data and the platform); no per-tool wall.
- **Self-serve companies from anetix.ai: pins, credit, manager accounts with
  2FA, and the www service** (2026-09-25, `src/selfserve.js`, the Pins tab and
  the AI credit and Sign-in sections of the company card on `/admin`, the
  credit line on the board, `public/enroll.html`, the manager half of
  `src/accounts.js` and `src/auth.js`; the front door is the `www/` folder
  beside `sos/`, its own repo `AnetixWWW` and Railway service `anetix-www`,
  its README has the deploy and Stripe steps). Brendan: a home page on
  anetix.ai with a brief description, not open to the public yet ("only to
  people that we give an access pin to", "I do not want everyone using this
  willy nilly"), a Stripe payment that sets them up a demo company with credit,
  top-ups when they need more, the first purchase $30 for $30 of credit and
  top-ups at two dollars for one, and "all demo should be 2FA". **Pins**
  (`platform.access_pins`: pin as typed, eight characters from an alphabet
  with no 0/O/1/I, shown `XXXX-XXXX`; label = who it is for; `max_uses`
  default 1; `expires_at` default 30 days; `revoked_at`; `uses`): made on the
  Pins tab (`POST /api/admin/pins { label, max_uses, days }`, shown once big
  and readable again in the table), cancelled there (`POST
  /api/admin/pins/:id/revoke`; the company it made stays), `pinProblem(row)`
  (pure) is the one reason a pin is refused ("not one we gave out" / cancelled
  / expired / already been used). **Credit** is a balance, not a monthly
  budget: `platform.credit_ledger` (delta_usd, kind purchase | grant | adjust,
  ref = the Stripe checkout session id UNIQUE, paid_usd, note, made_by) and
  `platform.self_serve` (one row per such company: pin_id, email, contact,
  `handout_enc`, created_at); `credit(company)` = the ledger's sum minus
  `spentSince(company, self_serve.created_at)` (the same five sources as
  `monthlySpend`), with `balanceOf` (pure) giving level ok / amber under $5 /
  red at zero and the line the board shows; `agent.assertUnderCap` calls
  `selfserve.assertCredit` FIRST, so a self-serve company with nothing left is
  refused at every AI run with "Add credit at <SOS_WWW_URL>/c/<slug>/credit"
  (the company's own monthly cap and the instance cap still apply on top; a
  company with no self_serve row is untouched). A grant from the admin (`POST
  /api/admin/companies/:slug/credit { usd, note }`, negative takes back) makes
  a company self-serve from that moment (its spend counts from then), which is
  how a pilot company gets an allowance. `GET .../credit` is the ledger. The
  board payload carries `credit` (null unless self-serve) and `index.html`
  draws one quiet `.creditline` under the warnings, red when out, with an Add
  credit link for managers. **The www routes**, mounted in server.js BEFORE
  `auth.middleware` and opened by `X-SOS-WWW-Key` = `SOS_WWW_KEY` (constant
  time; under 16 characters or unset means the door is closed): `POST
  /api/www/pin`, `POST /api/www/check { pin, email }` (before the checkout),
  `POST /api/www/companies { pin, name, contact, email, ref, paid_usd,
  credit_usd, collect }`, `POST /api/www/credit { slug, ref, paid_usd,
  credit_usd }`, `GET /api/www/companies/:slug` (name, balance, managers).
  They are called on the PUBLIC address, so the edge check applies to them.
  **A company from a payment** (`createCompany`): slug from the name
  (`slugFrom`, pure; `-2`, `-3` when taken), a floor password
  (`auth.setPasswords({ floor })` only: NO shared manager password exists for
  such a company), a manager ACCOUNT (below), the pin's use spent, the first
  ledger row, all in one transaction under `pg_advisory_xact_lock(hashtext(
  'selfserve:' || ref))`, because Stripe's webhook and its success page land
  the same payment within milliseconds (seen in the test run: the second
  caller found the pin spent); the same ref again returns the company with
  `created:false`. **The handout**: the floor password and the manager's
  first password wait encrypted in `self_serve.handout_enc` (AES-GCM under
  `SOS_CONNECTION_KEY` through `connections.encrypt`) and are handed to the
  first caller that says `collect: true` (the person's browser, never the
  webhook), then wiped (`collectHandout`, a CTE, because `UPDATE ... RETURNING`
  gives the NEW value); an admin resets them from the company card if they
  were lost. **Manager accounts** (`platform.accounts` with `role='manager'`
  and `company=<slug>`, the shape reserved on 2026-09-21): login = the checkout
  email (`<local>+<slug>@<domain>` when that email already has an account), a
  made-up first password, the same scrypt, lock, recovery codes, trusted
  devices and sign-in log as an admin account. Sign-in: the login page's
  account form ("Sign in with an account (managers, Anetix staff)", opened by
  `?account=<login>` with the name filled in), `POST /login { name, password,
  code }` through `accounts.signIn` (role admin or manager), the cookie
  `manager.<slug>~<account id>.<account generation>...` (`auth.signManager`;
  `verify` answers `{ role: "manager", company, account }`), the middleware
  checks `accounts.sessionState` (active, a manager of THAT company, the
  generation) and sets `req.sosAccount = { id, login, name, role: "manager",
  company, enrolled }` (an admin's carries `role: "admin"` now). **Enrollment
  is the first stop**: until the authenticator is verified the account
  reaches only `auth.managerEnrollPath` (`/c/<slug>/enroll`,
  `/api/c/<slug>/me`, `.../me/enroll/start|verify`, `/logout`); a page
  request is redirected to `/c/<slug>/enroll` (`public/enroll.html`: Start,
  the QR and the setup key, the code, ten recovery codes shown once) and an
  API call gets 403 `enroll_required` with `enroll_url`. `POST
  /api/c/<slug>/me/password { current, password }` changes it (signs out
  everywhere). The Accounts tab lists admins only (`accounts.list`);
  `accounts.managersOf(slug)` feeds the company card's Sign-in section (login,
  enrolled or not, last sign-in, New password and Reset authenticator through
  the existing `/api/admin/accounts/:id/<action>` routes with the step-up
  code) and `coFlag` no longer flags a company whose manager is an account.
  `SOS_ADMIN_2FA=off` (break glass) covers managers too. Company delete
  removes the ledger, the self_serve row and the manager accounts (factors,
  codes and devices cascade); the three tables are in the backup. **Env**:
  `SOS_WWW_KEY` (shared with the www service; `openssl rand -hex 24`),
  `SOS_WWW_URL` (default https://anetix.ai; the top-up link). **Tests**:
  `scripts/test-selfserve.js` (29 then, 38 since the wall), `scripts/e2e/selfserve.js` (75: the
  door, a pin's life, the company with its handout both ways round, the 2FA
  sign-in end to end with real TOTP codes, the credit gate on arrival and on
  the button, top-up idempotency, grants, delete, backup) in `run-all.sh`;
  the www service has `scripts/test-www.js` (18) and `scripts/e2e.js` (34,
  the whole way in with a fake Stripe, the webhook racing the page). **Known
  limits**: the manager account's session windows are the manager's (30 days
  idle) not the admin's; the person who closes the welcome page before
  writing the passwords down needs an admin (New password on the card); no
  email is sent by anything (Stripe's receipt is the only mail); a pin is
  stored as typed (it is an invitation, not a password); the www service
  keeps the welcome passwords in a signed cookie on that browser for seven
  days so a reload shows them again.
- **anetix.ai is a wall** (2026-09-25, the `www/` service's `pages.wall` and
  gates, `selfserve.loginCors`, `selfserve.creditToken` / `topupUrl`; Brendan:
  "nothing visible or showing what we are doing that is publicly accessible
  without a pin"). Without a pin anetix.ai is one page: a sign-in (name,
  password, the authenticator code) and a pin box, as two tabs at the top of
  one card ("Have a pin?" first, "Sign in"; the corner link before
  2026-09-26 was missed and people typed the pin into the password), with
  "Public site coming soon" under the card; the description, the people, the prices and the
  pictures open only with a good pin (re-checked on every view). The wall's
  sign-in posts to THIS product's `POST /login` across the origin:
  `loginCors` (in front of the route in server.js, plus `app.options`) answers
  CORS with credentials for `SOS_WWW_URL`'s origin and its `www.` twin only;
  the same site, so the session and trusted-device cookies land on this host,
  and the page then goes to `/admin`, the manager's board or its enrollment.
  `/login` itself is unchanged. The board's Add credit link and the
  "Add credit at" refusal now carry `?t=<exp>.<mac>` (HMAC-SHA256 over
  `credit:<slug>:<exp>` under `SOS_WWW_KEY`, 32 characters, exp 31 days out
  rounded to the day; no key, no token); the www service opens a company's
  top-up page only for that key, the browser that paid for it, or the way
  back from Stripe. **Admin preview** (the same evening; Brendan: signing in
  from the wall takes him to the product, so how does he see the pin page):
  "View the pin page" on the Pins tab (`openWwwPreview`, the tab opened before
  the fetch so a popup blocker lets it through) asks `GET
  /api/admin/www-preview` (admin only, `selfserve.previewToken`: HMAC over
  `preview:<exp>`, ten minutes) and opens `<SOS_WWW_URL>/preview?t=...`; the
  www service gives that browser a preview cookie that opens every pin page,
  marked as a preview, and refuses to make a company. Tests:
  `scripts/test-selfserve.js` (40, the keys and the CORS answer), `scripts/e2e/selfserve.js` (75); the www side has
  `scripts/test-www.js` (29) and `scripts/e2e.js` (60: the wall says nothing, the preview,
  the pictures and top-up page are shut, the preflight from the wall and not
  from elsewhere, a pin opening and then closing the page, the key). Known
  limit: this product's own `/login` page at app.anetix.ai is still public
  and says "Symbiotic OS" and "floor and manager passwords".
- **The demo workflow** (2026-09-25 evening, `src/selfserve.js`, the Pins tab,
  the board's `#demobar` and `.creditout`; Brendan: a pin made for someone
  needs their email too, then 2FA, then their demo board with a small rolling
  "Demo" banner, $15 of credit loaded, and when it runs out anetix.ai to add
  more at $30 for $15; $10 and $20 for $10 since 2026-09-26, below). `platform.access_pins.email` (required on a new pin,
  `makePinRow`; a pin from before, NULL, takes any email) and
  `pinEmailProblem(row, email)` (pure) are checked on `/api/www/pin`,
  `/api/www/check` and in `createCompany`, so the product never makes a
  company for another email whatever the www service sends. `createCompany`
  takes `password` (the person's own, `accounts.passwordProblem`; the handout
  then carries only the floor password and the manager's login) and `demo`
  (`platform.companies.demo`, on the board payload's `company`); `paid_usd` 0
  writes the first ledger row as a `grant` made by "anetix.ai", not a
  purchase. A demo has NO floor password (Brendan, same night: one person
  experimenting, one manager-level account): `createCompany` with `demo` makes
  none, hands out nothing, and calls `auth.accountsOnly(slug)`, an access row
  with no floor or manager hash and `legacy_login` false, so neither a company
  password nor the shared SOS_FLOOR/MANAGER fallback opens it; the manager
  account with its authenticator is the only way in (an admin can still give
  it a floor password later from the company card). The board: a 22px `#4c90d1` strip over the band rolling "DEMO · a
  demo company on Anetix" (CSS, still under prefers-reduced-motion) for a demo
  company; at zero credit the quiet credit line becomes a red panel ("Your
  demo's AI credit is used up. Everything you built stays ...") with "Add
  credit on anetix.ai" (the keyed top-up link, managers; the floor is told to
  ask the manager); and `window.alert` on the board page turns any error that
  says the credit is used up (the board's own actions and the new-module
  popout) into a question that goes to that link. Tests:
  `scripts/test-selfserve.js` (43), `scripts/e2e/selfserve.js` (93, the demo
  section at the end), `board-browser.js` (22, unchanged); the www side's
  `e2e.js` (56) walks the whole thing, and a headless run went pin and email,
  the form, the welcome page, the authenticator, the board with its strip, the
  credit drained to the red panel and on to the $30 page.
- **Demo sign-in and the credit as a percentage** (2026-09-25, late; from the
  first outside tester). (1) "It takes you to a pin only enter, then it errors":
  a demo manager who was not signed in (after Sign out, or opening a board link)
  landed on `/login`'s company-password box, which a demo does not have. Now
  `GET /login/mode?c=<slug>` (before the auth middleware, `auth.loginMode`)
  answers `account` for an accounts-only company and `password` for anything
  else (a floor company, an unknown code, junk), and `login.html` opens the
  account form at once for `account` ("Sign in to <slug> with your email and
  password, then the code ..."); `/logout` sends a named account (admin or
  manager, `verify(...).account`) to `/login?staff=1`, which opens the same
  form; a floor or company-password sign-out lands on `/login` as before.
  (2) "I do not want to show what $ credits, just a percentage": the board's
  credit line is `AI credit: 64% left.` (or "used up. Nothing new will be
  proposed or built until more is added."), never dollars. `balanceOf` returns
  `percent` = the balance over ONE demo allowance, `SOS_CREDIT_UNIT_USD`
  (default $10 since 2026-09-26, was $15), so a new demo reads 100% and it can go past 100: Brendan the
  same night, "if they have 5% left it should take them to 105% ... I do not
  want to have a frustrating rip off system there" (an earlier version that
  reset to 100% at a refill was replaced before it shipped); amber under 25%;
  `1%` while anything at all is left. The refusal is "this company's AI credit is used
  up. Add credit at <link> to keep going." with no figures. The dollar fields
  stay on the object for the admin page and the www service. On anetix.ai the
  pin page, the set-up form and the welcome page name no dollars of credit
  ("AI credit from us", "$30 through Stripe refills it"); the top-up page says
  "N% of the AI credit left" and one button, "Refill my AI credit / Pay $30" (a refill ADDS 100% on top of what is left);
  the Stripe line is "Anetix: AI credit refill for <company>"; after paying,
  "Your AI credit is refilled. N% left now." The $30 price is the only
  dollar figure a demo person sees. Tests: `scripts/test-selfserve.js` (47),
  `scripts/e2e/selfserve.js` (97: the mode for a demo and for everything else,
  both sign-outs, 100% after a refill, 0% used up); www `test-www.js` (31),
  `e2e.js` (56); the headless walk (13) signed out, came back through a board
  link to the account form, signed in with a real code and read "AI credit:
  100% left.".
- **$10 demo credit; a started build finishes** (2026-09-26, Brendan, on the
  Opus 5.5 baseline: the free credit should build one module and run about
  three rounds of changes, not much more). A demo starts with $10 (www
  `DEMO_CREDIT_USD`), the percentage unit is $10 (`SOS_CREDIT_UNIT_USD`), a
  refill is $20 for $10 (`TOPUP_USD` 20, `TOPUP_RATE` 0.5), so a refill is
  still exactly +100%. Demos made before keep their $15 grant and read 150%
  when new. "A build already started always finishes even if credit runs
  out": `assertCredit(company, { started: true })` / `assertUnderCap(company,
  { started: true })` let through work that passed the gate when it began:
  the pipeline's build step (so the first build after `startRun` or a
  confirmed requirement, every fix round, and the platform's own restart of
  an orphaned run) and a module creation's rounds and design (the gate is at
  `intake.create`, `restart`, and the `/build` route for a design whose build
  never started). A manager's Retry (a build from scratch) needs credit again
  (`pipeline.retry` unless `opts.auto`). The monthly budgets still apply to
  everything. A balance under zero shows 0%, and `addCredit` writes the
  overrun off before any refill or grant (an `adjust` row by `platform`,
  "overrun written off ..."), so a refill always starts from zero. The wall
  also catches a pin typed into the sign-in (`caughtPin` in `signinScript`: 8
  characters of the pin alphabet, or the name field with a dash or a digit;
  no password is that short), never sends it to `/login`, and moves it to the
  pin box with the email; a browser that has signed in there
  (`localStorage anx_signed_in`) opens on Sign in, every other browser on the
  pin box. The admin's new-pin box gives the link `<www>/pin`, which opens the
  pin box directly.
- **Sample data for a demo's tools** (2026-09-26, `src/sample.js`, the board's
  "Sample data" link on a tool and "Try the preview with sample data" on a
  build at the gate; Brendan: "simulate data for the current build so they can
  get a better representation of what it does"; his choices: demo companies
  only, into the tool itself and its preview, a filled snapshot not live
  motion, paid from the demo's credit). The AI (the propose job's model) reads
  the tool's reference.md, migrations, columns and code (routes first, 45k
  characters) and writes about a week of history plus work in progress, never
  a row of the company's data; `migrate.rowsProblems` checks it, one retry with
  the problems. Keys the database makes (serial or identity, one column) are
  placeholders from the AI and remapped to the real ones; a foreign key or a
  `<thing>_id` column naming a table in the set (thing, things, thinges)
  follows, and tables are ordered by both (`fkOrder(tables, fk, extra)`). A row
  that does not fit is left out with every row pointing at it, so a sample row
  never lands on the person's own. Columns come from the newest schema (stg_
  while a build waits, else mod_); rows go into live and, same keys, into the
  preview; a table or column only the waiting build has (and a first build not
  live yet) is filled in the preview and carried into live by
  `sample.afterDeploy` from `registry.hooks.deployed`. Clear deletes by key
  (or by the values given, for a table without one) from live and the
  preview, children first; a sample row something of the person's points at
  is kept and counted. `platform.sample_fills` (status writing, in, cleared,
  failed; `rows`, `plan` { order, keys, live_cols, pending }), in the backup,
  deleted with the company; a fill still writing at boot is marked failed. One
  fill in force per tool (replace clears first); refused while a build of the
  tool is running and when the credit is gone (`assertUnderCap`, a fill is a
  start); spend filed as `ai_usage` kind `sample_data`, shown to the person as
  a percentage only. Record kinds `sample_filled`, `sample_cleared`. Routes:
  `GET|POST /api/c/:slug/modules/:mod/sample`, `POST .../sample/clear`
  (manager; 404 for a company that is not a demo). Tests:
  `scripts/e2e/sample.js` (35, in run-all.sh), `scripts/test-sample.js` (10).
  Fixed the same day after seancorp/atmosphere-logs: the first fill worked, then
  every fill after the tool's revision failed "none of the sample rows fit" and
  the database's reason was thrown away. Now: every refused row's reason is
  kept (per table, in `sample_fills.error`, the record's `left_out_because`,
  the log, and the failure message); the AI is told each table's checks and
  unique columns from the database itself and the newest migrations (a long
  set keeps its end); a JSON column takes an object or a list (`jsonReady`,
  `fitProblems`); any one-column primary key with a default (a uuid too) is a
  made key; placeholders match as text ("1" is 1); a row that clashes on a
  unique column with a sample row an earlier clear had to keep takes that row
  over (`leftoverKeys`); when under half the rows fit, nothing goes in and the
  AI is asked again with what the database said, then whatever fits is kept.
  Simpler the same afternoon (Brendan: "burning through credits getting
  failures ... we need a bit of a simpler solution"). The logs showed why:
  seancorp's five fills cost $2.40 and the last one had no database reason at
  all, because the agent tried to write a week of hourly readings (5 spaces x
  4 gases x 168 hours), ran past its length limit and came back cut off and
  empty. Now: ONE call on the short text model (`agent.summaryModel()`,
  Sonnet 5; `SOS_SAMPLE_MODEL` overrides), 8000 tokens at most, asking for
  only the latest rows (10 a table, 80 in all) plus a `repeat` list
  { table: { covers_minutes, back_hours <= 168 } }; the platform copies those
  back in time itself (`expandRepeats`: timestamps moved, decimals nudged up
  to 3%, the rows pointing at each copied row copied with it, placeholders
  "<ph>~k", at most `SOS_SAMPLE_MAX_ROWS` 1200 rows). The answer is never
  refused whole (`tidy`: JSON text read, unknown tables and columns dropped),
  no second AI call, and whatever the database takes is kept. A fill that
  fails costs the demo nothing: its spend is filed as `sample_data_failed`
  and handed back as an `adjust` ledger row by `platform`; every failure is
  a `sample_failed` record row (so the Demos export shows it).
  `agent.runStructured` now also returns `stopReason`. Delete a demo from the
  Demos tab too ("Delete this demo", the company card's delete).
  Tests: `scripts/e2e/sample.js` 38, `scripts/test-sample.js` 20.
  Third shape, same day (the repeat version filled Atmosphere Logs with five
  rows and no logs: each hourly log holds twenty readings in one JSON column,
  the answer ran long, came back cut off, and the partial answer was taken as
  a success; Brendan: "enough data for full functionality, for example the
  weekly oxygen graph, with some natural variance"). The AI now gives
  `rows` (the few specific rows the story needs, 40 at most) and `series`, a
  recipe per table: { every_minutes, back_hours <= 168, time_column, times:
  { col: [min, max] minutes after }, columns: { col: spec } } or { for_each:
  { table, column }, combine: { col: [values] }, columns }. A spec is a value,
  { pick, weights }, { around, spread, decimals }, { by: col, values },
  { pick_from: table }, or a JSON object or list of specs.
  `generateSeries` builds the bulk (seeded, capped at 1500 rows): a timed
  series on the grid back from now, skipping any time a specific row holds,
  any time held in another table's column of the same name (a missed hour is
  not also logged), and any time the tool's own table already holds (a log
  taken by hand); for_each rows per parent and combination, their pointer
  passed to putIn as a link. `stop_reason` max_tokens is a failure (refunded),
  never a partial success. The raw answer is kept in `sample_fills.answer`.
  Record detail `series` counts what was generated per table. Tests:
  `scripts/e2e/sample.js` 39, `scripts/test-sample.js` 26.
- **The AI spend meter** (2026-09-26, `agent.meter`, `platform.ai_calls`,
  `credit.withMeter`). The key ran out while the glide slope said about $14
  was left: since the 9/20 anchor ($94.52) the features had filed $80.67, and
  the diagrams drawn after every deploy (`src/diagrams.js`, Opus reading the
  whole module source, about $0.30 to $1.00 each) had cost $19.85 more, filed
  only in `platform.diagrams.cost_usd`, which no total read. Now: `SPEND` in
  src/credit.js and `agent.monthlySpend` include `platform.diagrams` (a
  demo's credit, `selfserve.spentSince`, does not: Anetix draws them unasked);
  every API answer is written to `platform.ai_calls` the moment it arrives
  (`runStructured` before parsing, `runChat`, `runAgent` on every way out,
  never in fake mode), with tokens, our cost and, for agent runs, the SDK's
  own figure; `credit.status` adds whatever the meter saw beyond the features
  since the anchor (`unrecorded_usd`, said on the line when $0.50 or more) and
  counts each day from the meter's first as the larger of the two. An agent
  run files the larger of the SDK's `total_cost_usd` and our own count from
  the usage (cache reads 0.1x, cache writes 1.25x), logging when ours is over
  1.2x. At boot only diagrams never attempted are drawn (a failed one was
  paid for again on every restart; Regenerate on the Diagrams page redraws).
  Tests: `scripts/test-credit.js` 33.
- **Passkeys** (2026-09-26, `src/passkeys.js`, `public/assets/passkey.js`,
  the wall in `www/pages.js`; Brendan: email then the 2FA app would be
  easier; the answer was passkeys, "much more durable, lets build that").
  Sign-in is the email, then Face ID, a fingerprint or the device PIN: no
  password, no code. `@simplewebauthn/server` 14 (CommonJS) checks both
  ceremonies; user verification required, discoverable credentials
  (residentKey required), attestation none, ES256 and RS256. The name a
  passkey is made for (`rpIdFor`): `SOS_PASSKEY_RP_ID`, else the parent the
  product and the wall share (app.anetix.ai + anetix.ai -> anetix.ai), so one
  passkey works on both; answers may come from https on that name, www. and
  app. under it, the wall's own origin, and the product's (http only on
  localhost). At sign-in the browser offers whatever passkeys it holds for
  the name (no allowCredentials), the server finds the account by the
  credential id, and the email typed only has to match: nothing says whether
  an email has a passkey. A passkey is added only by an account whose
  authenticator app is set up (the middleware keeps others on their setup
  page), so the password and app stay the fallback and the recovery codes
  the way back; Reset authenticator removes an account's passkeys too.
  `platform.account_passkeys` (credential id, COSE public key, counter,
  transports, synced, label from the user agent, last used, removed; ten at
  most per account; in the backup with the account tables) and
  `accounts.passkey_handle`. Challenges live in the process for five minutes
  and are used once. Routes: `GET /api/me/passkeys`, `POST
  /api/me/passkeys/options`, `POST /api/me/passkeys`, `POST
  /api/me/passkeys/:id/remove` (a named account), `POST
  /login/passkey/options` and `POST /login/passkey` (public, before the
  middleware, `selfserve.loginCors` like /login, 30 begins a minute an
  address); a passkey sign-in gets the session `auth.startAccountSession`
  gives a password sign-in (one function now). `anx_pk=1` on the parent
  domain (no secret, not HttpOnly) tells the wall and the product's sign-in
  this browser has used one: they open passkey-first with the password
  behind "Use my password instead", and the wall opens on Sign in. Both
  sign-in pages also start the browser's passkey autofill on the email box
  (`autocomplete="username webauthn"`, conditional mediation). Where a
  person adds one: the last step of a manager's setup page, a one-time offer
  on the board (dismissed per browser, `anx_pk_nudge`), Settings (Your
  sign-in) and /admin (My passkeys; the accounts list shows how many).
  auth_events: passkey_added, passkey_removed, login_passkey,
  passkey_refused. Tests: `scripts/test-passkeys.js` (9),
  `scripts/e2e/passkeys-browser.js` (26, Chromium's virtual authenticator,
  both servers on localhost; the command is at its top). Admin step-up for
  destructive actions still asks for the app's code.
- **Demo requests** (2026-09-26, `src/demorequests.js`, the form in
  `www/pages.js` request(); Brendan: "an intake form for someone who wants to
  get a demo, and what sort of demo they want (just a pin or a call), how they
  heard about it ... then that will come in on the pins page"). anetix.ai/request
  (linked from the wall's pin tab, "No pin yet? Request a demo") asks name,
  work email, company, role, phone, size, what the business makes, pin / call /
  both (call times shown for a call), what they would like it to help with,
  how they heard (plus who, for "someone told me"). www posts it with the
  shared key to `POST /api/www/demo-requests`; a filled hidden field gets the
  thank-you page and sends nothing; five an hour an address (in www's memory).
  `platform.demo_requests` (in the backup); the same email again inside a day
  adds to its open request (asks+1, a blank answer keeps the old one). The
  Pins tab's first card lists them (new, call booked, and pin sent with no
  company yet on top; the rest under Handled), a "Demo requests N new" pill
  and the tab's count while any are new. "Make their pin" makes a pin for
  their email (one company, 30 days by default) labelled "Name at Company",
  ties it to the request, sets Pin sent, and shows the message to send with
  Copy and Open in email: nothing sends mail from the platform yet. A second
  pin while one is live is refused (409). Call booked, Done, Decline, Back to
  new and a note. Routes: `GET /api/admin/demo-requests`, `POST
  /api/admin/demo-requests/:id` { status?, note? }, `POST
  /api/admin/demo-requests/:id/pin` { days? }. Tests:
  `scripts/test-demorequests.js` (9), `scripts/e2e/demorequests-browser.js`
  (33, both servers; the command is at its top).
- **Rebranded to Anetix** (2026-09-25, Brendan: "rebrand anywhere with
  Symbiotic OS to Anetix"). Everything a person sees: every page title
  (`Anetix · Board`, `Anetix · Sign in`, ...), the login card, the admin
  shell's product name, the authenticator app's entry (issuer `Anetix`, was
  `Anetix SOS`; apps already set up keep the old label and the codes still
  work), the recovery codes file, the printer test label, the IT note, the
  backup error, the boot log. Internal names stay on purpose: the repo
  `SymbioticOS`, the Railway service, every `SOS_` variable, `sos_` cookies,
  `sos-backup-1`, and this file's title.
- **The Demos tab: what Anetix learns from the demos** (2026-09-25, `src/demos.js`,
  `public/assets/admin-demos.js`, the Demos tab of `/admin` between Pins and
  Companies; Brendan: "see from admin what the person has spent, how much they
  have paid and important stuff ... collect feedback from their CI board and
  get an overview of their company ... see what people start building and use
  cases ... admin only"). Read only; every route is `requireAdmin` on the
  `/api/admin` path space the module page policy never opens (a demo's own
  manager gets 403, nobody signed in 401). `GET /api/admin/demos`: every
  company with a `self_serve` row, newest first, each with who (contact,
  email, the pin it came in on, the manager account, 2FA or not, last
  sign-in), money (`moneyOf`, pure, over the ledger: paid through Stripe,
  refills, credit bought, given, taken back; plus spent, balance, percent and
  paid minus AI spend), what it built (modules with live version and version
  count), counts (requests filed and shipped, requests to Anetix, new-tool
  requests, builds live and stopped), the loop's numbers from
  `health.forAdmin(0)` (approved, declined, shipped, median hours to live),
  last activity; the totals across them; and the USE CASES (`useCaseOf`,
  pure: every new-tool request's name, what it is for, what it tracks, how
  it is done today, who uses it, the design's one line, live or not).
  `GET /api/admin/demos/:slug`: that plus every new-tool request with every
  answer in order, question first (`answersOf`, pure, fixed questions then the
  generated rounds) and its design, every request on the board in the
  person's words with where it is and the proposal or the outcome, every
  build with its title and what changed, the ledger, spend by kind, and the
  interaction record newest first (600 steps; "Download the record" on the
  page has them all). `GET /api/admin/demos/export`: every company in full as
  one JSON file (`anetix-demos-1`) for reading the learnings offline. The
  page: totals, one row per company (click for all of it,
  `#demos/<slug>`), the use cases; the company view links its board (an
  admin session opens any board), its company card and its record. The admin
  page now has nine tabs. Tests: `scripts/test-demos.js` (7),
  `scripts/e2e/demos.js` (21, in `run-all.sh`), `accounts-browser.js` counts
  nine tabs.
- **Paid sites, stage 1: the price book and the Sites tab** (2026-09-26,
  `src/sites.js`, `public/assets/admin-sites.js`, the Sites tab of `/admin`
  between Demos and Companies; the whole plan, the data behind the prices and
  Brendan's decisions are `docs/PAID-SITES.md`). Brendan: a pipeline where a
  demo converts to a paying site on a subscription it can cancel any time, no
  usage limits beyond a fair-use line at 80% of the fee, priced per site.
  Decided 2026-09-26: five bands by the people at the site counting every shift
  (Small 1 to 49 $1,000; Mid 50 to 99 $1,750; Core 100 to 199 $2,500; Large 200
  to 499 $3,500 and Very large 500+ $5,000, those two still "proposed"); floor
  space moves a site up ONE band at most (proposed thresholds 75,000 / 150,000 /
  300,000 / 750,000 sq ft, 1,500 a person at each edge); no start rate (full
  price from month one); the admin activates every site, within 24 hours of the
  signature; cancelling returns a site to a demo; AI cost in a billing period may
  not pass 80% of the fee. **Stage 1 plans and shows; nothing charges anyone.**
  Pure: `BOOK_V1` and `bookProblems`; `bandOf({ headcount, sqft })` (the band,
  its annual price, fair-use line and alert, `moved_up` with `why`, and `flags`:
  within five below a band edge, floor space per person under 150 or over
  5,000); `fairUse({ spend_usd, fee_usd, lifted })`; `next(state, event)`, the
  stage machine (demo, ordering, signed, activating, subscribed, back_to_demo;
  standing good / past_due / unpaid; the cancel date; every event in the plan
  and every refusal, with the effects stages 2 to 4 carry out, e.g. a cancel on
  an unpaid month answers `end_now`); `orderText` and `textHash` (the order form,
  `TERMS_VERSION` "draft-1" until counsel has read it); `refundableCredit` (free
  credit counts as spent first, purchases oldest first, what is left of the
  bought credit comes back at each purchase's rate); `cleanFields` (only the keys
  sent change). Tables: `platform.price_books` (version 1 is rewritten from the
  code at boot until a site has gone past ordering under it, then frozen; a new
  list price is version 2) and `platform.sites` (`id` uuid, the permanent id
  orders and Stripe will point at, since a freed slug goes to the next company
  with the same name; `company` unique; the facts, `deal` JSON, note, stage);
  both in the backup. Company delete takes the row and is REFUSED while a site is
  activating or subscribed (`sites.deleteRefusal`: end the subscription first,
  because the delete never talks to Stripe). Routes, admin only: `GET
  /api/admin/sites` (the book, the count per stage, a row per self-serve company
  or site row with its facts, band, pin holder, since, tools live, AI spent and
  the deal), `POST /api/admin/sites/quote { headcount, sqft }`, `POST
  /api/admin/sites/:slug` (the pipeline fields; 409 once an order is signed).
  The tab: the price book with a quick quote for a call, the stage counts, the
  pipeline table, and a form per row (one column on a phone, 16px boxes); a
  company that is not self-serve joins the pipeline once a field is saved for it
  and reads "Not ordered yet". Next: the go-live screens and the signed order on
  anetix.ai (stage 2), Activate and the rollover (3), the month to month (4),
  master agreements (5); `orders`, `customers` and `billing_events` arrive with
  the stage that uses them. Tests: `scripts/test-sites.js` (95),
  `scripts/e2e/sites.js` (32) and `sites-browser.js` (14), both in
  `run-all.sh`; `accounts-browser.js` counts ten tabs.
- **The Anetix mark** (2026-09-25, `public/assets/anetix-mark.svg`, the square
  with the blue A on #14171c, and `anetix-a.svg`, the A alone; the blue is
  the Finn Operations logo's #4c90d1, Brendan's ask): on the admin band, the
  login page, the enrollment page, as the favicon of those pages, and as the
  default company icon (`DEFAULT_ICON` in `src/feedback.js`; a brand with a
  primary colour and no icon gets the square in that colour). The www
  service carries the same two files under `/img/`.
- **Per-company AI budget** (2026-09-19). `assertUnderCap(company)` now checks
  the company's own monthly cap (`platform.companies.monthly_cap_usd`, set on
  the admin page) against that company's own spend AND the instance cap, so one
  company running out never blocks another. Before this, `assertUnderCap` read
  `monthlySpend(null)` (the whole instance), so any company hitting
  `SOS_MONTHLY_CAP_USD` froze builds for all of them. `monthlySpend(company)`
  returns `capKind` ("company"/"instance"/null) and the board KPI shows the
  company's own budget.
- **Backup keeps up with the schema** (2026-09-19, `src/backup.js`
  `PLATFORM_TABLES`). The dump always took every table; the restore list had
  fallen behind it and skipped module intakes, attachments and the checks-log
  labels and replays. It now restores all of them, decodes bytea columns
  (attachment bytes), and includes `company_access`; an older backup with no
  `company_access` brings its companies back on the shared passwords rather
  than locking anyone out. Round-tripped in the test run.
- **The interaction record** (2026-09-19, `src/record.js`, `platform.record`,
  build order item 3). What everyone said and decided, word for word, tied to
  the build it led to and how it turned out. One insert-only table (a trigger,
  `platform.record_guard`, refuses UPDATE and DELETE; the one sanctioned delete
  is a company's own, through `record.deleteCompany`, which sets a
  transaction-local flag the trigger honours). Each row: company, module,
  kind, actor_role (floor / manager / admin / agent / platform / person),
  actor_name (the name typed with feedback; a person once operators have an
  identity), the ids it ties to (feedback, proposal, run, intake, version),
  `before`, `after`, detail JSONB. Kinds: feedback_filed, feedback_closed,
  proposal_drafted (the AI's text), proposal_edited (the AI's text BEFORE,
  the manager's AFTER: until this the edit overwrote the AI's words in place),
  proposal_approved, proposal_declined (until this a decline logged nothing),
  requirement_drafted, requirement_confirmed (before/after, edited flag),
  build_finished, build_summarized, check_verdict (the gate, the tests, or the
  reviewer, with findings), run_fixed, run_overridden, run_retried,
  run_cancelled, deployed, rolled_back, version_switched, review_started,
  review_findings, intake_answered (each answer, before/after), intake_round,
  intake_design, intake_adjusted (before/after plus what was asked),
  intake_confirmed, intake_abandoned, doc_saved (before/after), doc_deleted,
  models_changed, label_set, chat_question, chat_answer. `record()` never
  throws: a failed write logs `[record]` and the loop goes on. Read back:
  `GET /api/c/<slug>/record?kind=&feedback_id=&run_id=&limit=&before_id=`
  (manager) and `GET /api/c/<slug>/record/export` (a JSON download, linked
  as "Download the record" on the admin card; until 2026-09-20 also as
  "record" in the board header). In `backup.js PLATFORM_TABLES`, so a backup carries it and a restore
  brings it back. Data terms decided 2026-09-18: the plant owns its record,
  Anetix uses it to improve that plant, anonymized cross-plant use is an
  opt-in clause; the cross-plant copy does not exist yet, and defense tenants
  stay out of it. Which person acted is recorded since operator identity
  (`actor_person`, next bullet). Not recorded yet: a proposal's rationale edits. What it feeds next:
  per-plant memory (lessons from adjusted and declined proposals), prompt and
  brief regression, a failure taxonomy, intake tuning, the pattern library.
- **Operator identity: a name and a PIN** (2026-09-19, `src/people.js`,
  `platform.people`, build order item 2b; Brendan: build it before "my
  requests", so a request follows the person across devices from day one).
  Two layers, on purpose. The DEVICE stays signed in with the company's floor
  or manager password (`src/auth.js`) and that alone decides what the device
  may do. The PERSON is who is standing at it: picked from the company's
  names on the feedback button, proven with a PIN (4 to 8 digits, scrypt
  hash, the platform makes a 4 digit one that is never 1111 or a run), kept in
  a second signed cookie `sos_person` = `p.<id>.<company>.<generation>.<issued>.
  <refreshed>.<mac>` (HttpOnly; it slides since 2026-09-24, a week idle and 30
  days cap, `SOS_PERSON_IDLE_HOURS` / `SOS_PERSON_CAP_HOURS`; it was 12 h
  fixed, `SOS_PERSON_HOURS`, which is no longer read). `people.attach` (after
  `companyGuard`) sets `req.sosPerson`, `req.sosPersonId`,
  `req.sosPersonRole`, only when the person is active, the generation
  matches and the person's company is the session's company. Nothing requires
  a person: a device with nobody signed in works as before. The role on a
  person (floor / lead / manager) is a label for now; it grants nothing.
  Five wrong tries lock a name for five minutes; a new PIN or a switch-off
  bumps the generation and signs the person out everywhere within ten
  seconds (a small in-memory cache). What it changes: feedback is filed with
  `person_id` and the person's name whatever was typed; `record.actor(req)`
  carries the person, so every manager and floor action in the interaction
  record says who (`actor_name`, `actor_person`). Routes, split on purpose:
  `/api/c/<slug>/who` (GET names + me, POST `/who/sign-in`, `/who/sign-out`)
  is the picker, open to any device of the company; `/api/c/<slug>/people`
  (GET the full list, POST add, `/:id/pin`, `/:id/active`) is the manager's
  list (`requireManager`). A module page's browser policy opens `/who` only,
  so agent-written code running in a manager's browser cannot add a person or
  reset a PIN (proven in a headless browser). Pages: `/c/<slug>/people`
  (manager; a PIN is shown once), the picker inside
  `public/assets/feedback-widget.js` (`window.sosPerson = { me, people, open,
  refresh, onChange }`, a digit pad that works on a tablet; its keyboard
  listener exists only while the pad is open and never touches the page's own
  handlers), the person chip in the board header. Record kinds: person_added,
  person_pin_reset, person_switched_on, person_switched_off,
  person_signed_in. `people` is in `backup.js PLATFORM_TABLES` and in company
  delete. Unit: `node scripts/test-people.js`. Not yet: "my requests", asking
  the reporter a question, fixed it / not quite (the next push, which this is
  the ground for; shipped in the next bullet); handing the person to module
  code on `ctx` (the paperline station still has its own operator box);
  per-person rights.
- **Close the loop, floor side** (2026-09-19, `src/closeloop.js`, build order
  item 6, first half; Brendan: floor side first, and "not quite" asks what is
  still off and files it linked). Until this a request left the floor and
  nothing came back, and the platform never learned whether a change fixed
  anything. Three pieces, all on the feedback button. (1) My requests: the
  signed-in person's own requests, each with one plain line from
  `closeloop.stateOf` (on the board / the manager has a proposal / waiting on
  data from the office / approved, being built / built, the manager is
  checking it / live, did it fix it? / fixed / not quite / declined with the
  manager's reason / taken back off). A stopped build is "being built" to the
  floor; ERP words never appear. (2) What went live: `pipeline.deploy` stamps
  `feedback.shipped_version` and `shipped_at` (`rollbackRun` clears them);
  `GET /api/c/<slug>/who/news?module=` lists the last 14 days of shipped
  requests by version with the plain summary and who asked. The widget turns
  the reload after a deploy into "New here: <summary>. Maria G asked for
  this." (once per device per version, `localStorage sos.seen.<co>.<mod>`; a
  device that was never there is not told old news; a deploy with no request
  behind it keeps the plain "updated" banner). The person who asked gets a
  card instead: their words, what was built, "Did it fix it?" with Fixed it /
  Not quite / Later. The card opens once per sitting; after that, or after
  Later, it is a small amber pill beside the feedback button, so it never
  sits on top of the work, and My requests carries a "1 to check" badge
  until they answer. (3) The answer:
  `POST /api/c/<slug>/who/requests/<id>/answer` `{ answer: fixed | not_quite,
  what }`. Only the person who asked may answer; a request filed with nobody
  signed in may be answered by any signed-in person (the record says who).
  Fixed may later become not quite, once; not quite is final. Not quite needs
  words and files them as a NEW feedback row (`follow_up_of` = the original,
  same module, page, screen, the person's name and id), so it goes round the
  same loop with the manager's gate intact; the original stays shipped with
  `floor_answer`, `floor_answer_at`, `floor_answer_person`, `floor_answer_by`.
  The proposer is told (`closeloop.followUpContext`, added to the prompt in
  `generateProposal`): which request this follows, the first words, what was
  built and is live, and to close the gap without starting over. The board:
  a follow-up card carries an amber "Follow-up to #N: not quite" line with
  the first words; a shipped card says "<name> says: fixed it" / "not quite.
  The follow-up is #N" / "has not said yet" (single cards and inside a batch
  tile). Record kinds: floor_fixed, floor_not_quite (before = "fixed" on a
  change of mind, after = the words, detail.follow_up_id), and the
  follow-up's own feedback_filed carries detail.follow_up_of. Loop health:
  `answers` = fixed, not_quite, went_live, unanswered, unanswered_named,
  fixed_share, follow_ups_open; a tile ("fixed it, says the floor") and a
  line in the Shipped cell on /admin. A not quite is the miss signal; with
  the quiet stretch it is what says a cheaper build model is or is not good
  enough. All three routes sit under `/who/` because the widget calls them
  from module pages; they do no more than `/api/feedback` already lets a page
  do (read the signed-in person's own requests, file a request under their
  name), and nothing they file reaches the floor without the manager. Fake
  mode: the fake proposer's rationale says "Follow-up context received for
  request #N." when the context arrived. Units: `scripts/test-closeloop.js`,
  the `answers` cases in `scripts/test-health.js`. Not yet at the time (manager side of
  item 6): a clarifying question to the reporter, and nothing proposed a
  follow-up on arrival; both built 2026-09-20, see "Propose on arrival". The
  manager's own answer is the next bullet;
  emails to the manager are OFF the plan (Brendan, 2026-09-19).
- **The manager's close-out on a shipped tile** (2026-09-19, `src/closeloop.js`
  `managerAnswer` / `mayCloseOut`, the manager side of item 6 as Brendan
  redirected it: no emails for every change, "they will get so annoyed"; keep
  the floor's card; give the manager one small button on the tile). A shipped
  tile (status done, `shipped_version` set, not rolled back, a module's own
  request) shows a manager, while NOBODY has said anything about it, a small
  green "Done" button and a quiet "a little left" link, and nothing else asks
  the manager anything. Done (`POST /api/feedback/:id/closeout {answer:
  "done"}`, `requireManager`): `feedback.manager_answer` = done with
  `manager_answer_at`, `_person`, `_by` (the signed-in person's name, else
  "The manager", "Anetix" for an admin); the tile shows a check mark and
  "Done. Thank you, <asker>."; the asker's My requests line is state
  `thanked`: a check mark and "<who> marked it done. Thank you for sending it
  in.", with a quiet green "N done" badge on the My requests link until that
  device has opened the list once (`localStorage sos.thanked.<co>`; never a
  pop-up). Done stops the "Did it fix it?" card and pill from coming back for
  that request (the news items carry `manager_answer`, `to_answer` leaves it
  out) but the asker keeps a quiet "Actually, not quite": the manager can
  close a request, not speak for the floor. A little left (`{answer:
  "little_left", what}`, words required): files the words as a NEW feedback
  row tied to the original (`follow_up_of`), same module, page, screen and
  target, under the manager's name; the original stays shipped and says
  "<who> says: a little left. The follow-up is #N."; the floor is no longer
  asked about the original (`mayAnswer` false; a second follow-up would be a
  duplicate); the follow-up's card says "Follow-up to #N: a little left" (the
  board query sends `follow_up_origin`, the original's `manager_answer`) and
  the proposer is told the manager said it (`followUpContext`, same marker
  sentence). Refused in plain words: not live through a build, rolled back,
  the floor already answered (the tile already says so), answered twice. On a
  batch tile each request in "See the N changes" has the pair, the list now
  stays open across the 4 s redraw (`OPEN_BATCH`), and with two or more open
  requests the tile has one "Done, all N" (`closeOutAll`, one call per
  request). The inline "What is left?" box pauses the reload (`EDITING =
  "left:<id>"`). The route is id-addressed (covered by `OWNERS` in auth.js)
  and sits under `/api/feedback/<id>/`, which the module page policy does NOT
  open (it opens `/api/feedback` exactly), so agent-written code on a module
  page in a manager's browser cannot close a request out (proven in a
  headless browser). Record kinds: manager_done, manager_little_left (after =
  the words, detail.follow_up_id), and the follow-up's feedback_filed carries
  detail.by_manager. Loop health `answers`: manager_done,
  manager_little_left, `unanswered` now means nobody has spoken (floor or
  manager), and met / missed / met_share count each request once (a miss is
  the floor's not quite or the manager's a little left); the floor's own
  `fixed_share` is untouched. Units: `scripts/test-closeloop.js`,
  `scripts/test-health.js`. End to end, IN THE REPO this time:
  `scripts/e2e/closeout.js` (API, 50 checks) and
  `scripts/e2e/closeout-browser.js` (playwright, 26 checks), both against a
  server already up in fake mode on a fresh database (header of closeout.js
  has the one command; `scripts/e2e/lib.js` is the cookie-keeping client,
  `person()` and `ship()`).
- **Checks that accumulate, and a page load for every build** (2026-09-19,
  `src/acceptance.js`, `src/pageload.js`, `pipeline.runChecks`, build order
  item 7; Brendan: a real browser with a fallback; the manager may retire a
  promise, with a confirm). Found in the review: `test_run` and `visual_check`
  were "the page answers below 500", so a 404 passed, the UI lane had no check
  past the module gate, and nothing a build promised was ever checked again.
  Now both steps (and the module lane's test step) are `runChecks`:
  (1) `smokeCheck`: `/` and module.json's `smoke` paths answer BELOW 400,
  asked as that company's own manager (`auth.serviceCookie`), never with the
  internal token (the list is in module.json, which a build may have written;
  the paths go through `acceptance.pathProblem`). A path the floor's version
  ALSO lists and answers the same way is not held against the build; a path
  the build added has to answer. A redirect to /login is a loud platform
  fault, never a pass. (2) Acceptance checks: `checks/NNN-short-name.json` in
  the module's own files, "call this, expect that" (GUARDRAILS.md "Checks" is
  the format and the builder's rules: 1 to 12 steps, `call` or `page`, `as`
  manager or floor, `expect` status / json as a SUBSET with `$type $gte $lte
  $gt $lt $in $regex $exists $length $minLength $contains $every $not` /
  contains / lacks, on a page also visible / selector, `save` and `{name}`).
  A functionality build is told to leave ONE new check built from "how we
  will know it works"; a UI build adds none; a new module's skeleton carries
  `checks/001-the-list-answers.json`. EVERY check of the staged version runs
  against the staged mount on every build of every lane. A check is a promise:
  the module gate refuses a build that edits or removes an existing one
  (`lane-check-edited`, put back by the platform in a fix round, like
  migrations) and refuses an unreadable one (`check-format`). The check that
  came with THIS change failing (`kind: own_check`) goes back to the agent,
  which may edit it; one an EARLIER change left behind failing (`kind:
  promise`) is the manager's call: send it back (the agent is told never to
  touch that file) or retire it, `POST /api/runs/:id/retire-check { file,
  reason }` (`pipeline.retirePromise`: only a promise this build broke, only
  while this build still has the preview; row in `platform.check_retirements`,
  never in the file, so an agent cannot retire anything; record kind
  `promise_retired`; the same build is checked again at once). A retired check
  is skipped for that company's module from then on. `acceptance.originOf`
  finds the request a promise came with (first version carrying the file, the
  run that built it). Checks may write rows: they run on the staging copy and
  `registry.resetStagedData` puts the preview back to a fresh copy of the
  floor's data afterwards, pass or fail. (3) The page load: every screen in
  the manifest (a `:param` takes its value from a smoke path that fits, else
  1) is opened in headless Chromium through `puppeteer-core` with a MANAGER
  session for that one company, requests to anything but this instance
  refused. Stops: the screen answers 400 or more, an uncaught script error or
  unhandled rejection, one of the module's own calls answering 500 or more.
  Notes only: a 4xx on a call, console.error, an error thrown from the
  platform's own `/assets/` scripts. When a staged screen shows a problem the
  same screen is opened on the LIVE version and a problem already on the floor
  word for word (mount, line numbers, versions and timestamps taken out) is
  not held against the build. No browser (`SOS_BROWSER=off`, none found, will
  not start, dies halfway, or is sent to /login): the static look instead
  (every inline script parsed with `vm.Script`, every screen asked for); the
  run log and the gate line say which way it looked. Boot logs one
  `[pageload]` line saying whether the browser starts. Chromium comes from
  `nixpacks.toml` (`nixPkgs = ["...", "chromium"]`; Railway builds this repo
  with Nixpacks because railway.json says so, whatever the service settings
  show); found on the PATH or at `SOS_CHROMIUM_PATH`; it runs `--no-sandbox`
  because the container is root (agent-written page code in an unsandboxed
  renderer; the browser here is the platform's own check, not a place module
  code runs, and module code itself is now isolated, see option C). Evidence: `evidence.checks = { ok, kind, detail, smoke,
  acceptance: { total, passed, added, retired, wrote, failed: [{ file, title,
  new, steps, origin }] }, pages: { mode, screens, problems, inherited, notes,
  fell_back } }`; `test_run` / `visual_check` keep `{ ok, checked }`. Errors
  keep their prefixes ("internal tests failed:", "visual check failed:") so
  health counts them as tests; `health.testStopKind` and `checks.reasonFor`
  tell them apart (broke an earlier promise / its own check failed / a screen
  broke on opening / an endpoint did not answer). Fix rounds: `fix()` builds
  the agent's findings from the checks (`checksForAgent`,
  `evidence.findings_from = "checks"`, worded as the platform, not as a
  reviewer); override stays for a reviewer's opinion only. Board: a stopped
  build leads with the promises in their own words and the request each came
  with, a Retire button per promise (confirm, then a reason), everything else
  folded under "and N more things the checks found" and the detail under
  "what the check saw" (do not overload the manager); the gate shows one line,
  "checks passed: N endpoints answer · N promises kept (N new) · N screens
  opened"; the Versions panel has "What this tool promises"
  (`GET /api/c/<slug>/modules/<m>/checks`, manager). A functionality build
  that leaves no check is NOT stopped; the run log says so. Record kinds:
  check_added, promise_retired, check_verdict with `detail.kind`. Loop health:
  `builds.test_stops`, `checks_added`, `promises_retired`. `check_retirements`
  is in the backup and in company delete. The library modules carry their own
  checks (paperline 3, kpis 2), so their repo hash changed: a company whose
  live version is repo-sourced gets them at boot, one whose live version is
  agent-built sees "FROM REPO, NOT LIVE" in Versions (existing behavior).
  Fake mode markers, first attempt only, cleared by a fix round: BREAKPAGE,
  BREAKSYNTAX, BREAKPROMISE, BADCHECK, BADSMOKE, EDITCHECK, NOCHECK. Units:
  `scripts/test-acceptance.js`, `test-pageload.js`, gate and health cases.
  End to end in `scripts/e2e/`: `checks.js` (48), `checks-browser.js` (18,
  playwright), `checks-nobrowser.js` (7, run twice: browser off, browser that
  will not start). Known limits: a check is as good as the agent that wrote
  it (read the first live ones, S1-14); staging sequences are the floor's
  (`LIKE ... INCLUDING ALL`), so a check that inserts rows leaves gaps in the
  floor's ids; a check must not call a route that prints or asks an AI
  persona (guidance only, nothing enforces it); UI builds cannot add checks;
  with no browser an error that only happens when a script runs gets through.
- **Propose on arrival, with one question instead of a guess** (2026-09-20,
  `src/arrival.js`, `proposals.generateProposal(id, opts)`, build order item 8
  built together with the clarifying question left over from item 6, because
  both live in the proposer's one call). Until this a request sat under
  Feedback until a manager pressed "Review with AI", the operator could only
  type, a manager tallied repeats by eye, and ambiguous words got a guess. Now
  `POST /api/feedback` ends with `arrival.start(id)`: `claim()` is awaited (so
  the answer already says `arrival: "proposing"` and a button pressed in the
  same instant gets 409 "being drafted right now"), `work()` runs behind the
  response, one call at a time per company and module (`inOrder`), so a repeat
  sent a second later is read after the first. The ONE proposer call may now
  come back four ways (schema fields `triage`, `duplicate_of`, `triage_note`,
  `question`, present only when that outcome is allowed): **a proposal** (the
  ordinary case: the draft is on the card before the manager looks; an earlier
  undecided draft of the same request becomes `superseded`); **a duplicate**
  of an open request of the same tool (`arrival.candidates`: open, not itself
  folded, lower id, at most 40, each with its words and any drafted proposal):
  `linkDuplicate` sets `feedback.duplicate_of`, the root's `recurrence` is
  recounted, the board folds the row into the root's card ("Asked 4 times by 3
  people", `arrival.tally`, the other wordings under it, a manager-only "not
  the same" = `POST /api/feedback/:id/unlink`, after which it is proposed
  ALONE so it cannot be folded straight back), and a database trigger
  (`platform.feedback_dupes_follow`) keeps a folded row's status, outcome,
  shipped version and the manager's close-out in step with its root, so when
  the root ships everyone who asked gets "Did it fix it?" and answers for
  themselves, a decline reaches everyone with the reason, and Done thanks
  everyone (close-out on a folded row is refused; `closeloop`'s reads join
  proposals and runs through `COALESCE(duplicate_of, id)` and My requests says
  "The same thing as request #N, so it was added to it."); **a question**:
  only when the words can be read two ways that lead to different changes and
  the source does not settle it, one plain question with two or three answers
  to tap (`arrival.cleanQuestion`: two to three distinct short options, and
  the text must pass `plainwords.check`, else it is dropped with a log line
  and the proposal stands), stored in `feedback.question`, NO proposal yet.
  It goes to the person who asked, on the screen they are standing at (the
  widget looks every 3 s while the proposer is reading what this device sent,
  two minutes at most, and on every page load) and in My
  requests (state `question`, counted in the "to check" badge), and to the
  manager's card (answer buttons, "answer in my own words", "Propose anyway").
  Whoever answers first wins (`arrival.answerQuestion`, one conditional
  UPDATE), the proposal is then drafted with the answer in the prompt, and
  there is one question per request, ever. Who may see or answer:
  `arrival.mayReply`: the signed-in person who asked; for a request sent with
  nobody signed in, the device that sent it, by the request's `reply_token`
  (returned once to the sender, kept in `localStorage sos.ask.<co>` for 48 h,
  never sent to the board or any other page). **A flag**: `not_this_tool` or
  `new_tool` with one sentence for the manager, who can "Propose anyway" or
  decline. What the person points at and a photo ride along in the same POST
  and go to the PROPOSER: "Point at it" puts a glass pane over the page (the
  page itself is never pressed; `elementFromPoint` under the pane), and sends
  tag, id, classes, text, label, a short path, the first 400 characters of
  markup and the box (`arrival.cleanElement` cuts it down again server side,
  `elementLine` words it for the model); "Add a photo" scales to 1600 px JPEG
  on the device, the body limit is 6 MB for exactly `POST /api/feedback`, the
  server takes jpeg, png or webp up to 4 MB into `platform.attachments`
  (`feedback_id`; `SOS_PHOTOS_PER_DAY`, default 300 a company, past it the
  words still go through), and it goes to the model as an image block
  (`arrival.photoBlocks`). The manager's card keeps ONE quiet line ("pointed
  at ... · photo"). Guards: per-company switches on the Agent settings page
  (`companies.auto_propose`, `allow_photos`, `POST
  /api/c/<slug>/agents/arrival`; off = the old board, and the button still
  sorts and folds); `SOS_AUTO_PROPOSE_PER_HOUR` (default 40 requests a company
  an hour, past it requests wait for the button and the log says so); the
  company budget and instance cap as for any proposal; a failure of any kind
  leaves the request exactly as before this existed (`arrival: failed`, the
  button works); a call in flight at a restart is reset at boot. The button
  ("Review with AI" / "Propose anyway") passes `force` when the proposer has
  already read the request, and `datacheck.reproposeFeedback` always does: no
  sorting, no question, a proposal. Spend for a call that did not end in a
  proposal goes to `ai_usage` kind `triage`. Routes, split like `/who` and
  `/people`: `GET /api/c/<slug>/who/question?id=&token=` and `POST
  /api/c/<slug>/who/requests/<id>/reply` are open to module pages and answer
  only the asker (404 / 403 for anyone else, token or not); the manager's
  `POST /api/feedback/<id>/answer` and `/unlink` sit under the id-addressed
  path the page policy does NOT open (proven in a headless browser, with the
  switches and the credit routes). Record kinds: duplicate_linked,
  duplicate_unlinked, question_asked, question_answered (detail.via = asker |
  device | manager), request_flagged, arrival_settings; proposal_drafted
  carries on_arrival, with_answer, pointed, photos. Loop health: `arrival` =
  proposed, duplicates, questions, answered, answered_by_manager,
  waiting_answer, flagged, unlinked (the Filed cell on /admin); a folded
  request is not an open item of its own. Fake mode markers in the feedback:
  DUPE (the first open request listed), ASKME, ASKMEBADLY (a question that
  fails the plain-words check), NOTTHISTOOL, NEWTOOL, FAILPROPOSE, CREDITOUT;
  `SOS_FAKE_PROPOSE_MS` makes a fake proposal call take that long. Units:
  `scripts/test-arrival.js`. End to end: `scripts/e2e/arrival.js` (89, plus
  the guard, slow and restarted modes in its header) and
  `arrival-browser.js` (38); the older suites take the draft left on arrival
  through `proposalFor` in `scripts/e2e/lib.js`. Known limits: whether the
  REAL proposer folds, asks and flags well is unread (S1-15: read them, and
  keep wrongly folded wordings for the brief); every request now costs a
  proposal call; the question reaches a nameless sender only on the device
  that sent it; a photo is kept in the company's database with no retention
  rule yet; the element's markup can carry whatever text was on the screen.
- **The AI credit glide slope, and "the AI service is out" told apart from
  "the build is wrong"** (2026-09-20, `src/credit.js`, the top of the Loop
  health card on /admin). Why: live run 38 died after 170 messages with
  "Credit balance is too low", nothing had warned of it, and the manager's
  card showed the raw API message as if the build were at fault. Anthropic
  does not hand a key its balance, so the ADMIN enters it (`platform.ai_credit`,
  `POST /api/admin/credit { balance_usd, autofill, note }`); from there the
  platform subtracts its own spend since (the same five sources as
  `monthlySpend`), takes the burn from the trailing seven days (fewer when the
  instance is younger) and projects the day the balance reaches zero:
  "About $36.30 left, burning $4.74 a day (5 day average): runs out around
  Sep 28, 7.6 days from now", with the slope drawn under it (solid from the
  entered balance to today, dashed to zero; `slopeOf`). Amber under 7 days,
  red under 3, never an alarm for a low balance once "autofill is set up" is
  ticked (Brendan: autofill when live). Spend by anything else on the same key
  is invisible here, so the line says "about" and a fresh number re-anchors it.
  `credit.classify(message)` tells credit / key / busy from everything else;
  `pipeline.failRun`, the proposer on arrival and the Review button call
  `credit.noteFailure` (event `ai_unavailable`, shown red on /admin "and
  nothing has worked since" until any AI call succeeds or a balance is
  entered), the run gets `evidence.ai_unavailable`, the manager's card and the
  button read `credit.plain(kind)` ("The AI service was not available ...
  Nothing is wrong with your request and nothing reached the floor"), the
  checks log says "AI service unavailable" and loop health counts it as stop
  kind `ai`, NOT as a gate, reviewer or test stop (so it never resets the
  quiet stretch that decides on a cheaper build model). `project()` and
  `slopeOf()` are pure: `scripts/test-credit.js`. `ai_credit` is in the backup.
- **Module code runs in a process of its own, with a database login of its
  own** (2026-09-20, `src/runner.js`, `src/runner-child.js`,
  `src/runner-probe.js`, `src/dbroles.js`; tenancy trade study option C, build
  order item 9). The review's largest finding: `routes.js` is written by a
  build agent from words typed on a floor, and the platform `require`d it into
  ITS OWN process, where `DATABASE_URL`, `SESSION_SECRET`, the API key and
  every company's schema and files were one expression away. The module gate
  (a text check) narrows a careless or steered build; it is not a wall. This
  is the wall. Each company gets two child processes, `live` (the code a
  manager approved) and `staged` (a preview nobody has approved yet, up only
  while a preview exists), each started (a) as an unprivileged user of its own
  when the platform runs as root, one per company and lane, the two of a
  company sharing a group and the company's module folder closed to every
  other group; (b) with an environment of ONE variable (`SOS_RUNNER_BOOT`),
  which the child reads and deletes at once, so module code that looks at
  `process.env` finds nothing of the platform's; (c) under Node's permission
  flags where this Node has them (files readable only under the company's
  module folder and the app's `node_modules`, no child processes, no workers,
  no native add-ons); (d) with a database login of its own (`src/dbroles.js`):
  the live role reads and writes only its company's `mod_<company>_*` tables,
  the staged role reads the floor and writes only `stg_<company>_*`, so
  UNAPPROVED code cannot change a row on the floor. No CREATE/ALTER/DROP/
  TRUNCATE, no other schema, no `platform.*`, no another company, no files,
  no `SET ROLE`. Passwords are never stored: an HMAC of the role name under
  `SOS_CONNECTION_KEY` (else `SESSION_SECRET`), set again at every boot, so a
  rotated secret heals. The platform keeps everything else in its own process
  and stays the owner of every schema and the only one that migrates, clones,
  snapshots and restores (it calls `dbroles.grant` again after each, because a
  new table carries no rights). A request under a module mount is checked by
  sign-in, the company guard and the page policy FIRST (`registry.attach`),
  then handed to the child over a unix socket in a folder only that child's
  user can enter, WITHOUT the visitor's cookies (the child gets role, person,
  device as headers, never the session), guarded by a per-process token; the
  child's answer returns under the platform's headers minus any Set-Cookie (a
  tool cannot set a cookie or a CSP on the platform's address). What the
  platform lends (`ctx.connections`, `ctx.ai`, `ctx.agentDoc`, `ctx.peer`) is
  asked for over the fork's private channel and answered for the company that
  channel belongs to, whatever the child claims; `ctx.peer` reaches only the
  company's own sibling tools. Also gained: a module that throws, leaks or
  loops takes down one company's lane, not the instance (`request timeout` =
  504 then a liveness ping ends a stuck process, which restarts on its own; a
  crash restarts, with a 30 s back-off after five crashes in a minute); the
  "does routes.js load" check of a new module runs in a THROWAWAY process
  (`runner-probe.js`) with an empty environment and a time limit
  (`modulebuild.validateModule`), so a build whose `routes.js` loops at load
  no longer hangs the platform. `SOS_MODULE_RUNNER`: `auto` (default: a
  process of its own when the instance can do it, `selfTest()` finds out at
  boot and says so in the log and on `/admin`, else the OLD way inline and
  `/admin` says THAT in red, so the floor never goes dark because of this
  file), `process` (own process or the module is not mounted, for an instance
  holding a second company's real data), `inline` (the old way on purpose, for
  local work without root or Postgres role rights). Deploy-day safety net
  (`auto` only, `registry.bootNet`): a tool on the floor that answers 500 from
  its own process on one of its own smoke paths goes back inside the platform,
  loudly (`module_kept_inline`, listed on `/admin`), until someone looks. The
  unit of isolation is company and lane on purpose: two tools of one company
  already read each other through `ctx.peer` and one manager approves both.
  Env: `SOS_MODULE_TIMEOUT_MS` (30000, per request), `SOS_MODULE_LOAD_TIMEOUT_MS`
  (10000, routes.js load), `SOS_ROLE_CONNECTIONS` (12, per role),
  `SOS_ROLE_STATEMENT_TIMEOUT` (30s). Tables: `platform.runner_ids` (the user
  id per company; in `backup.js`? no, it is instance-local, so it is NOT
  backed up and is remade at need). Boot logs one `[runner]` line; company
  delete drops the processes, both roles and the ids (`runner.deleteCompany`).
  What only the live instance can settle, and the boot log now reports: whether
  Railway's Postgres user may make roles, whether the container lets a child
  run as another user, whether the app folder is readable to that user.
  Sandbox spike and full suites proved the three locally. Units:
  `scripts/test-runner.js` (role names, grants, header stripping, permission
  flags). Boundary: `scripts/e2e/runner-hostile.js` (37, needs Postgres and
  root): hostile `routes.js` loaded straight into a company's process, then
  every reach tried, the environment, another company's tables and files, the
  platform's tables, a Pool it builds by hand, the visitor's cookie, another
  tool's channel, a crash and an endless loop. Every e2e suite reruns green in
  process mode; `inline` reruns green too. Known limits: the wall is only as
  good as the container and the Postgres user (all three checks must read
  green on Railway, S1-17); the roles share one database, so a role that could
  exhaust connections is bounded by `CONNECTION LIMIT`, not partitioned; a
  company's two tools still share a login and a process by design; the API key
  is still one for the instance (per-company keys were cancelled 2026-09-20,
  billing is per iteration now).
- **Staging is a copy of the floor's data, on purpose** (decided 2026-09-19,
  closing the 2026-09-18 review finding "previews show real rows").
  `migrate.cloneSchema` copies structure AND rows from the live schema into
  `stg_<company>_<module>` for every build. Kept because: the copy never
  leaves the company's own database; the build agent has no database access
  (its tools are Read, Write, Edit, Glob, Grep on files); a preview with real
  rows is what lets a manager judge a change; and the acceptance checks run
  against realistic data. What does leave the instance is separate and
  smaller: a system review sends a snapshot of the smoke endpoints' answers
  to the model (`review.js`). Revisit for a tenant whose contract forbids
  even that, not before.
- **A model reads a module's files whole** (2026-09-19, `src/modulesource.js`
  `sourceText`, used by `proposals.moduleContext` and so by the proposer AND
  the system review, and by `diagrams.js`). Found in the verification pass
  against the 2026-09-18 review: every one of those readers got pages cut at
  14,000 characters and every other file at 8,000 (10,000 for diagrams) in
  silence, which on the library modules was 8,000 of 21,603 characters of
  kpis/routes.js and 8,000 of 19,793 of paperline/routes.js: functionality
  proposals, whole-module reviews and data-flow drawings written from under
  half of the server file. Now every file is whole. One overall budget
  (`SOS_CONTEXT_CHARS`, default 400,000 characters) guards the model's
  window; over it, files are kept in order of need (the screen the feedback
  came from, module.json, routes.js, other .js, pages, reference.md,
  migrations, other docs, tour.json, the rest), the overflow is cut at the END
  of that order, each cut is marked in the text where it happens, a NOTE at
  the top names the cut files and tells the model not to assume what it
  cannot see, `[context]` goes to the log, event `proposal_context_cut`, and
  `proposal_drafted` carries `detail.context_chars` (and `context_cut` when
  anything was). Cost: about 3 to 7 cents more per Fable proposal on the
  library modules (15k tokens in against 8k to 12k); the review estimate
  follows on its own. RULE: never slice a file going into a prompt without
  saying so in the prompt and on the record. Unit:
  `node scripts/test-modulesource.js` (the library modules arrive whole).
- **Connections, first push: spreadsheets and label printers** (2026-09-19,
  `src/connections.js`, `public/connections.html` at `/c/<slug>/connections`
  (manager), `public/assets/print-helper.js`, build order item 5, designed in
  docs/MODULE-CREATION.md "Connections: the outside world"). The rule: the
  platform owns every connection, the module only uses it. A module declares
  what it needs in module.json `connections: { name: { kind, label, ... } }`
  (the gate and `validateModule` refuse a kind the platform does not have, a
  files connection without `table` and `key`, a printer whose
  `labels/<name>.zpl` is missing); the platform keeps one row per declared
  connection in `platform.connections` (settings, status, detail, an
  encrypted `secrets` column ready for the ERP kind, key `SOS_CONNECTION_KEY`
  else derived from SESSION_SECRET, never in the agent env), created at mount;
  the module gets `ctx.connections.<name>` with a small fixed surface. `files`:
  the manager uploads a csv or xlsx on the connections page, the platform
  parses it (attachments.js parsers, every row), matches headers to the
  module table's columns (loosely, plus the module's aliases), previews with
  typed sample rows and problems, then loads in ONE transaction on the live
  schema (delete the matching keys, insert every row; any unreadable cell
  stops the whole load); `platform.connection_uploads` keeps the parsed rows
  until loaded. Surface: `status()`. `printer`: Zebra Browser Print on the
  device. The module keeps `labels/<name>.zpl` with `{{field}}` placeholders
  and calls `print(req, name, data)`; the platform renders (ZPL control
  characters stripped from data), queues a row in `platform.print_jobs` for
  the DEVICE that asked (`sos_device` cookie, minted by
  `connections.deviceCookie` on module pages, the connections page and the
  print API), and the print helper the platform injects into the pages of a
  module with a printer connection polls `GET /api/c/<slug>/print/next`
  every 2 s while visible, asks once which printer this device uses
  (localStorage), POSTs the ZPL to Browser Print on localhost:9100 (9101
  https), reports `.../print/jobs/<id>/done|failed`. Unclaimed jobs expire
  after 10 min; jobs a device took and never reported fail. The page policy
  of such a module adds `localhost:9100/9101` and `/api/c/<slug>/print/` to
  connect-src and nothing else. `preview(name, data)` renders a PNG through
  Labelary (`SOS_LABELARY_URL`, https://api.labelary.com; null when
  unreachable, as in the sandbox); the connections page shows the test label
  and the module can show its own. Test label and printer settings (size and
  dpi, preview only) live on the connections page; the manager pairs each
  printing device there or on the first label. Record kinds:
  connection_loaded, connection_settings, connection_tested, label_printed,
  label_failed. `paperline` declares `stock` (files into `inventory`, key
  item+location) and `labels` (printer, `labels/traveler.zpl`, printed from
  station 1). Backup carries the three tables; company delete removes them.
  Unit: `node scripts/test-connections.js`. Not yet: the generated setup
  walkthrough (the page carries a fixed text per kind for now), uploads from
  a module page (the module links to the connections page instead), the
  scanner kind (needs nothing).
- **Connections, second push: the ERP kind** (2026-09-19, `src/connections.js`
  erp section, the connections page's ERP card with an admin-only setup form,
  `modules/paperline` "erp"). Read only, through named queries. The module
  declares each query it needs (`queries: { name: { params, fields, about } }`);
  the gate refuses a module that carries `base_url`, `url`, `user`,
  `password`, `path` or `host` (the platform holds those). The ADMIN (Brendan,
  during pilots: decided 2026-09-19) enters on the connections page: flavor
  (`sap_odata`: SAP Gateway / S/4HANA OData v2 or v4, `epicor_baq`: Kinetic
  BAQ REST, `json`: any read-only JSON endpoint), base URL, transport
  (`direct`; `bridge` is designed in and answers "not available yet"), answer
  freshness, SAP client, certificate check (off for a self-signed on-prem
  certificate), the login (user and password or an API key, encrypted with
  AES-256-GCM under `SOS_CONNECTION_KEY`, else SESSION_SECRET; SET
  SOS_CONNECTION_KEY ON RAILWAY so a session secret rotation does not lose the
  logins; a login that cannot be decrypted says so and asks for it again), and
  per query: the path after the base URL with `{param}` placeholders (URL
  encoded, OData quotes doubled), the system's field behind each module field
  (dotted paths), test values. `POST /api/admin/connections/:slug/:mod/:name/erp`
  saves it and clears the cache; the login never comes back out of any
  endpoint. The manager's Test button (`.../test`, shared with the printer
  kind) runs every query with its test values and reports rows, a mapped
  sample and fields that came back empty (a wrong field name), plus a path
  that uses a `{param}` the query does not declare. The module's
  `query(name, params)` reads `platform.erp_cache` when fresh, else calls the
  ERP (`httpGet` over http/https with a 15 s timeout, 20 MB cap, plain-words
  errors for refused, not found, certificate, 401/403/404), maps the fields,
  stores the rows, and on failure returns the cached rows with `fresh: false`
  (the connection stays connected with `last_error` set) or throws with the
  reason when nothing is cached. The IT note (`.../it-note.txt`, and on the
  card) is templated in plain words from the declaration and the settings:
  what read-only access, which lookups and fields, where the calls come from,
  how the login is kept, what we need back. A stand-in ERP for the showroom
  answers at `/erp-demo/parts` and `/erp-demo/orders` (public, static rows,
  SAP OData v2 shape, `$filter=Field eq 'x'` and `$top` honoured), so a demo
  company's erp connection can be set up with base URL `<host>/erp-demo/`.
  `paperline` declares `erp` with one query `parts` (fields item, description,
  on_hand, reorder_at) and the stockroom page shows an "ERP says" column with
  "below reorder point" and an as-of line. Backup carries `erp_cache`. Not
  yet: the bridge transport itself, a generated (not templated) walkthrough,
  SAP CSRF-protected writes (never).
- **The ERP is admin side; the data check at review** (2026-09-19, Brendan:
  the manager's view must not carry lookups, fields or BAQs, "otherwise it
  gets much too complicated"; "there should just be a check the agent does
  during reviewing to see if it has access to the data"). `src/datacheck.js`,
  `platform.data_requests`, `proposals.data_check`. (1) Admin only: the ERP
  card on the connections page (`connections.companyView(company, { admin })`
  strips it server side to label + status + `managed: true` for anyone else:
  no settings, address, lookups, columns, samples, audit, drafts or IT note),
  the ERP Test (the shared `.../test` route answers 403 to a manager for an
  erp connection), the IT note, setup, drafts, and platform-written agent docs
  (`source='platform'`, i.e. `ERP-FIELDS.md`, are left out of
  `GET /api/c/:slug/agents` unless the role is admin). Managers keep printers
  and spreadsheets. (2) The check: for a module with an ERP connection,
  `generateProposal` adds `erp_data` to the proposal schema (what, in the
  manager's words; the lookup; the published field that covers it or empty)
  and tells the model to write the proposal as it will work once the data is
  there, never naming lookups or fields to the manager. `datacheck.verify`
  checks each named field against `connections.fieldAudit` (catalog plus
  declared fields that resolve); THE PLATFORM DECIDES, the model's opinion of
  availability is never used. `data_check.status`: none (needs nothing), ok,
  waiting (something missing: a row per missing need in
  `platform.data_requests`), unavailable (the admin dismissed the last open
  request with a reason). The board query sends the manager only
  `proposal_data = { status, reason, missing: [plain words] }`. waiting: one
  amber sentence, no Approve, Decline stays; the decide route, the batch
  build and `/api/runs/batch` all answer 409 in plain words. unavailable: the
  admin's sentence in red; approve only together with an edited proposal
  (the manager changed the ask). (3) Admin: the "Data requests" card on
  /admin (`GET /api/admin/data-requests`, `.../:id/resolve` = "it is there
  now: propose again", `.../:id/dismiss` with a sentence the manager reads).
  A catalog change in `setErp` (the set of published names differs) calls
  `datacheck.catalogChanged`, which proposes the module's waiting items again
  behind the response (old draft -> `superseded`, its requests closed by the
  new proposal's `apply`). Record kinds: data_check, data_request_resolved,
  data_request_dismissed; event data_request_opened. Loop health:
  `decisions.waiting_data` and its oldest age ("waiting on us"), kept apart
  from what waits on a manager. Fake mode: `ERPNEED:<field>` in the feedback
  makes the fake proposer need that field (empty = nothing covers it).
  Same push, from the cross-check: the ERP cache key now includes the
  module's declared fields (a version that reads one more field never gets
  rows cached without it); an answer under an hour stale is served at once
  with `fresh: false, refreshing: true` and refreshed behind it
  (`erpQuery(..., { refresh: true })`), so a floor page only ever waits on the
  ERP for a lookup it has never made; the Test flags a lookup that hit the
  5000-row cap; `erp_cache` and `data_requests` are in the backup.
- **ERP field catalog, paging, lookup drafts** (2026-09-19, third connections
  push; the workflow is docs/ERP-ONBOARDING.md). Why: the ERP hookup is the
  most engineer-heavy thing we do, so a lookup must cost us time ONCE. The
  lookup is built WIDE in the ERP; Test records every column it returns
  (`columnsOf`: name, type, one sample, kept in `connections.detail.columns`,
  bookkeeping columns dropped); "Publish every column" (`setErp` with
  `publish`) gives each a plain name (`autoNames`: `JobHead_JobNum` ->
  `job_num`, the prefix kept on a collision) into
  `settings.queries.<q>.catalog`, where the admin may rename and annotate. A
  declared field resolves through `resolveFields`: the hand map, then the
  catalog, then a unique loose match on the column's own name, else null; the
  Test says how each resolved. `writeFieldsDoc` keeps the module agent doc
  `ERP-FIELDS.md` current (names, types, notes, never values; written at
  mount, on setup and on test), and `agent.guidanceFor` already hands every
  module doc to the proposer, the builder and the reviewer, so a request for
  one more ERP field is an ordinary functionality change that needs nobody
  from Anetix or IT. `fieldAudit` and `auditLine` put one line in the run log
  of every build of a module with an ERP connection ("ERP fields: every field
  the module reads is available" or which are not yet) and the same on the
  card. Paging: Epicor and plain JSON are paged with `$top=500&$skip=n` until
  a page is empty or partial (a page at a round hundred is followed by
  another request, because a server may cap pages at 100; a repeated first
  row stops an endpoint that ignores `$skip`; a path with its own `$top` is
  left alone); SAP follows `d.__next` or `@odata.nextLink`; 5000 rows at most.
  A 401 that mentions an API key says "it wants an API key as well" (Epicor
  REST v2 wants the user, its password AND a key; the form says so now).
  `draftLookups` (`POST /api/admin/connections/:slug/:mod/:name/draft`, admin,
  the company's propose model, spend recorded as `erp_draft`, record kind
  `connection_drafted`) has the model write what IT needs to build each
  lookup, wide on purpose, with a suggested ERP object name (`SOS_...`), the
  path, a field map, the extra fields it included and why, and what it could
  not know about this installation; for Epicor the definition is one
  read-only SELECT for BAQ Designer's SQL import (Kinetic 2024.2 and later; no
  CROSS APPLY, no OPENJSON). Nothing touches the ERP: a person there builds
  it and the Test proves it. "Use its path and field map" fills the form.
  A second stand-in ERP, Epicor shaped, answers at
  `/erp-demo/epicor/BaqSvc/SOS_<anything>/Data` (1230 jobs, `Table_Field`
  columns, 100 rows a page at most, wants `x-api-key` and Basic auth, BAQ
  parameter `JobNum`). Units in `scripts/test-connections.js`.
- **Loop health** (2026-09-19, `src/health.js`, `GET /api/admin/health?days=`,
  the top card on /admin, build order item 4). The platform's own numbers,
  per company and across the fleet, for Brendan (the manager's board shows
  none of this, by design). A window (7, 30, 90, 365 days, or 0 for all
  time; default 30) over: feedback filed; proposals approved (and how many
  the manager edited first), declined, waiting; builds started, shipped,
  rolled back, cancelled; stops by kind (gate = the platform's own checks,
  reviewer = the cross-check, tests = smoke and visual, other), fix rounds,
  overrides; time to floor (feedback filed to deployed, the oldest item of a
  batch; median, p90, and the same-shift share, within 8 hours); manager
  wait (proposal drafted to decided; then ready to deployed); AI spend in
  the window, per shipped change, this month against the cap; build models;
  intakes. As of now, not windowed: open feedback and its oldest, what is
  waiting on a manager (decisions, requirement confirmations, deploys), in
  flight, and the quiet stretch (days since the last reviewer or test stop,
  gate stop, rollback; a long one is the signal to try a cheaper build
  model, per the 2026-09-18 decision). Sources: the primary tables and the
  run log's timestamped lines (`deploy`, `rollback`, `error`, the ready line
  of each lane), so the whole history counts; the record adds decision times
  and edits, and a decision before the record uses the run's start.
  `compute()` is pure and unit tested (`scripts/test-health.js`, synthetic
  rows, fixed clock); `forAdmin()` is the one call the page makes.
- **Board simplified** (2026-09-20, Brendan: "so intuitive", "keep it a
  little black box like"; `public/index.html`, `public/settings.html`,
  `scripts/e2e/board-browser.js` 22 checks). What left the board: every
  model name and every dollar figure (run lines, review bars, the cross-check
  line, "proposed by", "Approve build (model)", the Adjust form's "Build
  with", the batch bar's model select, the system review's model select and
  estimate, the intake popout's estimate, the "guided by: docs" line); the
  KPI strip; the header links (people, agent settings, checks log,
  connections, record, wall sign); "Add to batch" on every card and the two
  batch panels; the wall-sign modal. What the board has now: top right is
  "signed in as <role> · <person chip> · Settings · sign out" (admin also
  "admin"); the module strip as before (Open live, Preview, Diagrams,
  Versions, + New module); the system review toolbar with the module picker
  and the button only; one panel at the top of Reviewing per module with two
  or more proposals waiting, "Build these N together" (`renderTogether`,
  `POST /api/runs/batch` with the proposal ids, so the same run a batch made;
  the server-side batch routes stay for the API and are unused by the board);
  on every card ONE big button for what it waits on and the rest under a
  small "more" (`actions(key, primary, [rest])`, a `<details class="more">`
  drawn as a dropdown, `OPEN_MORE` keeps it open across the 4 s reload, a tap
  elsewhere or on one of its buttons closes it): new = Review with AI (or
  Propose anyway, quiet, when a question or a flag is what the card waits on)
  + more(Decline); reviewing = Approve build + more(Adjust, Decline), or
  Adjust as the primary when the ERP cannot provide the data; requirement
  gate = Confirm + more(Adjust the requirement, Cancel); running =
  more(Abort build); deploy gate = Deploy / Put it on the floor +
  more(Discard); stopped = the reason first, then Send findings back (else
  Retry from scratch) + more(Override where allowed, Retry, Cancel), the
  retire buttons stay inside their findings; shipped = the close-out Done as
  before + more(Roll back); module request = the one step it is on +
  more(Withdraw, the design). Every gate is unchanged; nothing was removed
  from the API. `/c/<slug>/settings` (manager, `settings.html`): People
  (link), Printers and spreadsheets (link), the wall sign (QR inline, Print
  the sign prints just the sign, Copy link), and the two arrival switches
  (moved off the agents page, same `/api/c/<slug>/agents/arrival`). The
  admin company card links Settings, Agent settings and docs, Checks log,
  People, Connections and the record.
- **No model names in the module creation flow** (2026-09-26, Brendan: "I do
  not want to give that back door information to what we are doing"). The
  intake popout, the request card, the question hints, the attachment error
  and the intake system prompt all say "the agent", never Fable or any model
  or vendor name. Keep it that way in any copy a company's people can see;
  model names stay on the admin pages only.
- **Phone layout of the board** (2026-09-26, Brendan walked his dad through
  the demo on a phone with large text and the band was unusable). At 640px
  and under: the module strip folds behind one "Modules" button whose summary
  says what the board is showing (`.modtoggle`, `MODOPEN` kept across the 4s
  reload), each module is a full-width row (name, version, links on their own
  wrapped line, 34px+ tap targets), "+ New module" is a full-width row, the
  four columns show one at a time behind a 2 by 2 tab row (`.coltabs`,
  `COLTAB`, `showCol`), and the column `h2`s hide. The intake popout puts the
  round and Close on the first line and the title under them, uses 16px boxes
  (so iOS does not zoom on focus) and full-width foot buttons. Desktop is
  untouched; `.modcard .links` is `display:contents` there.
- **System review lives on the settings page** (2026-09-26, Brendan: only what
  is used every day stays on the board). The board's toolbar (`renderToolbar`,
  `.toolbar`, `startReview`) is gone; `settings.html` has a System review card
  (`loadReview`, `startReview`, same `POST /api/c/<slug>/reviews`) with the
  module select, the button and a polling line while one runs. The board still
  shows a running review and its recommendations in `renderReviews`.
  `scripts/e2e/board-browser.js` checks the card on the settings page and its
  absence from the board (it still looked on the board until the Sites push).
- **A named account's requests carry its name** (2026-09-26, Brendan: Taylor,
  signed in as an admin with a code, sent a request that arrived as "no name").
  `POST /api/feedback` files the name as: the person tapped on the device
  (name and PIN) first, else the account behind the session
  (`req.sosAccount.name` or login), else the typed name. `/api/c/<slug>/who`
  returns `account: { name }` beside `me`, and the feedback button shows
  "Sending as <name>" and hides the name box for an account too. The floor's
  nameless path is unchanged.
- **Board band** (2026-09-19): one title row and one quiet module line
  (`.band`, `.modstrip`, `.modcard`), 70px on a desktop against roughly a
  third of the screen before. Module names are the filter toggles, versions
  and links are small text, the printable QR moved from a permanent tile to a
  "wall sign" link that opens the same card, the filter hint sits at the end
  of the module line only while a filter is in force. Chips wrap on phones.
- **Board tiles fold** (2026-09-17): each of the four columns shows
  `TILES_PER_COLUMN` (3) tiles and a "Show the other N" button; `EXPANDED`
  keeps opened columns across the 4s reload. The header count is the total.
- **Module creation intake** (2026-09-17, push 3 of docs/MODULE-CREATION.md;
  the build from a confirmed design is the bullet above). A manager presses "+ New
  module" on the board strip (or "New module" on an admin company card, which
  lands on the board with `?intake=<id>`). That creates a feedback row of
  `kind='module_request'` (new column; `intake_id` too) and a
  `platform.module_intakes` row; the tile on the board is the status and the
  way in, the popout (`public/assets/intake.js`, one file, its own CSS) is
  where the answering happens. Fixed questions live in
  `src/intake-questions.js` (13, the last one only when the company has other
  modules; answer shapes documented at the top of that file). Answers save
  one at a time (`POST /api/intakes/:id/answer`); `next` checks the open
  round is complete (409 with the missing ids), sets status `thinking` and
  runs `intake.think` in the background: the design job's model (chosen at
  create and kept on the intake row; `SOS_MODEL_INTAKE` is no longer read)
  returns either a round of up to 6 questions (ids
  `r2q1`..., at most two generated rounds, or `enough`) or the design
  (`DESIGN_SCHEMA`: bluf, check items, reference_md in the module-formats
  shape, screens, connections, starting data, leaves_out, change guidance,
  plus `estimate_usd` from `estimateUsd`). Every generated string passes the
  plain-words guard (`src/plainwords.js` over `principles/PLAIN-WORDS.md`: a
  word check, one rewrite on the short text jobs' model (Haiku until 2026-09-22, Sonnet 5 since), the check again; a question that still fails
  is dropped, a design line is flagged in `design.flags`; the company's own
  system names from the works_with answer are allowed). Attachments
  (`src/attachments.js`, `platform.attachments`, bytea, 15 MB and 10 per
  intake): photos and pdfs go to Fable as image and document blocks
  (`runStructured` now takes `blocks`), csv and xlsx are parsed to rows with a
  dependency-free reader (xlsx is a zip of xml; unusual files fall back to
  "save it as csv"). Design gate in the popout (a deliberate exception to
  gates-on-the-tile): tick every item, Adjust the text (Fable re-issues the
  design with the edit as the authority, `adjust`), Start over (keeps the
  fixed answers), Approve build (`confirm`, status `confirmed`, then
  `modulebuild.startBuild` at once: status `building`, then `done`). Text
  boxes show "N characters left" from 80% of their limit and say plainly
  when full. Withdraw on the tile (`abandon`, feedback declined). Fake
  mode returns a canned round 2 and a canned design. Module requests are kept
  out of batches and the proposal engine (`kind='feedback'` checks). The
  intake router is mounted before the platform router because the attach
  route parses a bigger JSON body. Spend goes to `ai_usage` as kinds `intake`
  and `design`.
- **Talk instead of typing** (2026-09-24, `public/assets/dictate.js`): a mic
  button under every answer box in the module creation popout and under the
  three boxes of the feedback widget (the message, "What is still off?", and
  "Say it in my own words"). Version 1 uses the browser's own speech
  recognition (Web Speech API): free and no server route, but Chrome sends
  audio to Google and Safari to Apple, and Firefox has none (no button shows
  there). Before a defense or CMMC customer, swap this one file for a
  record-and-transcribe-on-our-server version; callers only use
  `Dictate.attach(el)`, `Dictate.scan(root, selector)` and
  `Dictate.stop(within)`. Words land as they are heard and fire an untrusted
  `input` event, so the popout's save and counter run as for typing; a
  trusted keystroke in the box stops listening. `stop(within)` keeps the words
  still in flight and cuts the mic; the popout calls it at the top of
  `render()` and in `close()`, the widget before every Send and when the
  panel closes. It also stops on its own when the box leaves the page, the
  tab is hidden, or after 3 minutes. The board loads the file with a script
  tag; on module pages the widget adds it itself (same origin, so the page
  policy's `script-src 'self'` covers it; speech recognition is not a
  `connect-src` request). The popout's character counter sits under the mic
  row (`counter()` skips `.sos-dictate`). Not yet checked on the live site:
  the mic prompt on a module page under the policy's `sandbox` directive, and
  plant noise.
- **Module filter** (2026-09-17, `public/index.html`): with more than one
  module, each module card's title in the strip is a toggle and an "All
  modules" chip sits in front. `SEL` (a Set of module names, null = all) is
  read from `?m=a,b` first, else `localStorage["sos.modules.<slug>"]`, is
  normalized against the company's modules (unknown names dropped, empty or
  every module = all) and always written back to both, so the URL shows the
  pick in force and can be linked. Clicking a title from "all" shows only
  that module; clicking again adds or removes. `visible(module)` gates the
  four columns, batch tiles, the "Build these N together" panels, the review
  bars and the system review default (first visible module); the Platform
  requests strip ignores it. `load()` fetches and
  `render()` draws from `DATA`, so a toggle redraws without a fetch.
- **Board layout** (`public/index.html`; the KPI strip, the QR tile and the
  batch panels below are history since 2026-09-20, see "Board simplified"):
  header band, module strip (Open live / Preview vN / Diagrams per module),
  KPI strip, system review toolbar, four columns. The band's top right holds the company's **board QR code**
  (`GET /api/c/<slug>/qr.svg?px=N`, drawn by `src/qrcode.js`, a dependency-free
  byte-mode encoder at error correction M, versions 1 to 10). It encodes
  `<proto>://<host>/c/<slug>/` from the request headers, so each company's code
  opens that company's board (login first if the scanner has no session).
  Clicking the tile opens a card with a large code, the link, Copy link and
  Print; the print stylesheet prints just that card as a wall sign. The band
  is two columns (title + module strip on the left, the 112px QR tile
  spanning both on the right). Platform feedback (about the tool itself,
  shipped from Cowork) sits in a collapsed "Requests to Anetix" strip under
  the columns, not a column of its own (see "Requests to Anetix").
- **Batches are server state** (the board stopped using them on 2026-09-20,
  "Build these N together" posts to `/api/runs/batch`; the routes remain)
  (`platform.batches`, `feedback.batch_id`,
  routes `POST /api/c/<slug>/batch/add|remove` with `feedback_ids`,
  `POST /api/c/<slug>/batch/<id>/clear|build`): one open batch per module
  (`run_id IS NULL`). Cards join or leave at the New or Reviewing station
  ("Add to batch" greys to "In batch" plus a Remove link; Approve build and
  Review with AI grey out while the item is in a batch). The panels at the
  top of the Feedback and Reviewing columns carry the actions: "Review the N
  new with AI" (one proposal call per item), "Build the N together" (only
  reviewed items go in; the rest leave the batch), Clear. Build sets
  `batches.run_id`; cancel and deploy clear `batch_id`. The old client-side
  checkbox selection and sticky batch bar are gone. "+1 seen again" is gone
  from cards; new feedback has Decline (`/api/feedback/:id/close`).
- **Requirement gate** (functionality lane): the propose model now returns
  `bluf` (one sentence), `items` (one sentence per change) and the full
  `requirement`; stored in `evidence.req_bluf` / `evidence.req_items`. The
  card shows the BLUF, one check box per change, the full text under "See
  the full requirement", and Confirm stays disabled until every box is
  ticked (ticks live in the page's `CHECKED` set so the 4s reload keeps
  them). "Adjust the requirement" opens the full text for editing before
  confirming (`POST /api/runs/:id/confirm {requirement}`).
- **Abort and orphans**: `POST /api/runs/:id/cancel` now also works on a
  `running` run: the build agent's AbortController (`pipeline.ACTIVE`) is
  fired, the run is marked cancelled before the agent error lands
  (`failRun` leaves a cancelled run alone), a never-staged draft version is
  dropped (`registry.dropDraftVersion`), proposals go back to reviewing.
  Board: "Abort build" on running cards. At boot `pipeline.sweepOrphans`
  marks every `running` row failed ("the platform restarted while this build
  was running") and kicks the queues; that is what a build "paused with no
  way forward" after a redeploy was.
- **Preview highlights**: the build prompt asks the agent to put
  `data-changed="vN"` on every element it adds or visibly changes
  (PRINCIPLES.md rule 9; the cross-check prompt says this is expected). The
  staged bar (`feedback-widget.js`) outlines those elements with a NEW tag,
  and "what changed?" opens a panel with the run's plain summary and the
  screens whose files differ from the floor version, as links
  (`GET /api/c/<slug>/modules/<m>/staged-changes`, a text compare of the two
  versions, no tokens).
- **Rollback asks first** (confirm dialog on every Roll back button;
  Switch/Restore in the Versions panel already did).
- **Company brand** (`src/brand.js`, `companies.brand` JSONB): the admin
  gives a website when creating a company (or later, "Build the brand
  guide" / "Rebuild" on the company card, `POST
  /api/admin/companies/<slug>/brand {url, model}`). The server fetches the
  page plus up to 5 stylesheets (browser UA; the build agent has no
  network), extracts title, meta, icons, logo imgs, hex/rgb colors by
  frequency, CSS custom properties, font stacks, visible text, and asks the
  chosen model (Fable by default) to REWRITE the platform `principles/STYLE.md`
  for the brand (same sections, same specificity) plus structured fields
  (primary/accent/background/ink, font, company_name, tone). The result is
  the company-wide agent doc `STYLE.md` (editable on the Agent settings
  page). `agent.guidanceFor` drops the platform STYLE.md whenever a company
  STYLE.md exists, so an agent never sees two style files (with both in the
  prompt it kept the platform defaults; found 2026-09-14 with a Stanley
  Black and Decker test). Boot renames any leftover BRAND.md to STYLE.md.
  Site fetch: two tries at 30s for the page; when it still fails (bot
  protection: SBD hangs, langmuirsystems.com answers 403) the guide is built
  anyway from the model's knowledge of the brand, `brand.site_read=false`
  and the admin card says so; icons fall back to the DuckDuckGo/Google
  favicon services. The restyle proposal names the default hex values to replace; the icon (largest apple-touch-icon, else favicon, as a
  data URL) is served at `GET /api/c/<slug>/icon` (default SVG mark when
  none) and linked as favicon + apple-touch-icon on the board and on every
  module page (`registry.widgetInject`). The board band takes the primary
  color and the accent (CSS variables `--navy`/`--amber`), shows the icon
  next to the title. Status building/done/failed on the admin card (polls
  while building); cost counts toward monthly spend. **Restyle** (`POST
  /api/admin/companies/<slug>/modules/<m>/restyle`, and automatically when a
  module is added to a company whose guide is done): one approved UI
  proposal per screen (feedback items by "Brand"), built as one batch run
  that waits at the deploy gate, so the manager previews the branded module
  before it goes live. Fake mode returns a canned guide.
- **Company delete** (`POST /api/admin/companies/<slug>/delete
  {confirm_slug, password}`): admin role plus the slug typed back plus the
  admin password checked server-side (`auth.checkAdminPassword`); refused
  while the company has running/queued/waiting runs. Drops the company's
  live and staging schemas and its snapshots, deletes runs, proposals,
  feedback, batches, docs, reviews, diagrams, versions, modules, the row,
  the mounts and the materialized files; logs `company_deleted`. Modal on
  the admin page. Pilot-stage hardening (a second factor) is still to do.
- **Backup and restore** (`src/backup.js`): `GET /api/admin/backup` streams
  one JSON file (`format: sos-backup-1`) with every platform table and every
  `mod_*` schema's rows plus DDL (columns, sequences, constraints, indexes).
  `POST /api/admin/restore {password, backup}` (admin password; refused
  while a build runs; own 300mb body parser) rebuilds the module schemas
  from the DDL, refills the platform tables, resets sequences, then exits
  the process (Railway restarts it; boot re-materializes versions and
  mounts). Admin page: Download backup / Restore from a backup file. Railway's
  own Postgres backups (Backups tab on the Postgres service) are the other
  half; the MCP cannot switch them on.
- **Agent doc duplicates fixed**: `UNIQUE (company, module, name)` never
  fired for company-wide docs (module NULL), so every boot seeded another
  COMPANY.md and every save added a row, and guidance carried them all.
  `db.dedupeCompanyDocs` cleans up at boot and adds a partial unique index;
  all writes go through `db.upsertDoc`.
- **Schema names** are sanitized (`migrate.ident`): a slug with a dash gets
  `_` in `mod_`/`stg_`/`snap_` names, so dashed slugs work.
- **What the platform lends a module** (`registry.moduleServices`, on the
  ctx handed to `routes.js`): `peer(name)` is a READ ONLY query function on
  a sibling module's live tables (null if that module is not live for the
  company), `agentDoc(name)` returns the company's editable copy of a module
  doc, `ai.chat({model, system, messages, maxTokens, kind})` is a plain chat
  call through `agent.runChat` under the monthly cap with the cost written
  to `platform.ai_usage` (counted in `monthlySpend`), `ai.models`,
  `ai.modelFor(role)`, `manifest`. A module declares chat personas in
  module.json `agents: { id: { doc, label } }`; the doc file ships in the
  module, is seeded as an editable module doc (`seedModuleDocs`), and
  `guidanceFor` leaves it out of build prompts.
- **Plant KPIs module** (`modules/kpis/`, company demo by default): the
  manager's eight-week view plus **Jonah**, a chat agent for managers
  (`JONAH.md`, TPS and Theory of Constraints voice: what the data says, what
  it means, where to stand on the floor, one experiment). History is
  seeded deterministically on first request (`routes.js buildSeed`, 40
  working days ending yesterday) with the lean patterns baked in: flat
  demand, lumpy orders, lumpier production orders (bullwhip), Friday push
  and Monday idle, Body Fold as the constraint carrying the WIP and half
  the defects, defects rising on push days, paper bought in 2400 lots, four
  clip stockout days, lead time following WIP, on-time delivery sliding.
  `GET /api/kpis` returns everything the page draws plus computed `flags`
  and `live` (today's real paperline shifts and WIP through `peer`). Chat:
  `GET/POST /api/chats`, manager only; system prompt is JONAH.md plus
  `digest()` (a few thousand characters), default model the company's
  propose model, dropdown to switch; each answer shows its cost. Page is
  plain HTML with inline SVG helpers (line, bar, stacked area, h-bars);
  chart ids `c-bullwhip c-output c-wip c-lead c-quality c-inventory` are
  targets for the tour and the "Ask Jonah about this chart" buttons.
  `POST /api/reseed` (manager) regenerates the eight weeks ending yesterday
  before a demo. (The chats table uses `last_at` from the days when the
  validator rejected `updated_at` as a substring of UPDATE; fixed 2026-09-17.)

## What this is

The product version of Brendan's operations methodology: one app per factory
that hosts an improvement board, every module (live and staged versions), and an
agent build service that turns approved floor feedback into deployed changes.
See `docs/ROADMAP.md` for the vision and `README.md` for the run-it map.

First module: **Paper Airplane Line** (`modules/paperline/`). A five-station
line making paper airplanes in 2-minute shifts. It is deliberately a working but
imperfect v1 so participants feel the improvement loop. `docs/DEMO-RUNBOOK.md`
is the facilitator script. Second module: **Plant KPIs** (`modules/kpis/`),
the manager's view of the same line over eight weeks, with Jonah.

## Two revision paths, and which one to use

1. **In-app loop (costs API money, runs on the live instance).** Floor feedback
   on a module page → the proposer reads it on arrival (or, with that
   switched off, the manager clicks Review with AI) → proposal → approve →
   agent builds a new module version into staging → manager deploys. This is
   what participants exercise. It only touches module files stored in the
   database (`platform.module_versions.files`). Several proposals can be
   batched into one run (`POST /api/runs/batch`); one run is active per module
   and the rest queue (`build_runs.status = queued`, kicked by `kickQueue`).
   The agent runs with `permissionMode: acceptEdits` and `IS_SANDBOX=1`
   because Railway containers run as root and Claude Code refuses
   `--dangerously-skip-permissions` as root. Its environment is an explicit
   allow-list (`agentEnv()` in src/agent.js): API key, PATH/HOME, and
   `ANTHROPIC_*`/`CLAUDE_*` only. Never spread `process.env` into it; the
   agent reads floor-typed feedback, so it must not see `DATABASE_URL`,
   `SESSION_SECRET`, passwords, or `SOS_INTERNAL_TOKEN`.
2. **Cowork revisions (free).** Brendan asks Claude here; Claude edits the repo
   and pushes; Railway redeploys. This is for platform changes (anything under
   `src/`, `public/`, `server.js`, `principles/`) and for deliberate module
   revisions. Feedback filed about the platform itself lands on the Requests
   tab of `/admin` (every company; `GET /api/admin/requests`), in the
   "Requests to Anetix" strip of the board, and under My requests of whoever
   sent it. Move it along there (Looking at it, Working on it, a word back)
   and close it with Fixed (what changed, in the floor's words) or Not doing
   this after shipping: `POST /api/admin/requests/:id/close`. The older
   `GET /api/c/<slug>/feedback/platform` (manager session) and
   `POST /api/feedback/:id/close` still work.

Local smoke test of the whole loop, in the sandbox: `SOS_FAKE_AGENT=1
SOS_FAKE_DELAY_MS=4000 PORT=3999 node server.js` (the delay gives an abort
something to interrupt; the fake agent stamps a visible
`data-changed="vN"` line on the page so the preview highlight shows).

### How module versions work (read before touching `modules/`)

- The **database is the source of truth** for module versions. Version
  directories on disk (`data/modules/...`) are a cache rebuilt at boot. Railway's
  container disk is ephemeral and that is fine.
- `modules/<name>/` in the repo is the **seed source**. At boot the platform
  hashes it; a new module is imported as v1, and a changed hash is imported as
  the next version and deployed (snapshot first, migrations applied).
- So: to revise a module from Cowork, edit `modules/<name>/`, push, done. But
  if the in-app agent has built versions since the last import, the repo copy
  is behind. **Export the live version first** and edit that:
  `GET https://sos.finnoperations.com/api/c/demo/modules/paperline/export`
  (manager cookie) returns `{files}`; write them over `modules/paperline/`,
  then make the change. Otherwise the agent's changes get superseded (they
  remain in the DB and are still rollback-able, but not live).
- **Never edit an existing migration file.** Migrations are applied once per
  schema by filename; edits to `001.sql` do nothing on the live database. Add
  `002.sql` etc. Additive only (CREATE TABLE / ADD COLUMN / CREATE INDEX /
  INSERT). The validator rejects DROP/UPDATE/DELETE/etc. and even the bare
  word `do` anywhere in a statement, so mind seed text.
- Migration seed values (starting inventory, settings) only apply to a fresh
  database. To change them on the live instance use the module's API or SQL.

## Deploying

The Cowork sandbox cannot push to this repo (its git proxy only injects
credentials for repos attached to the session, and the SymbioticOS repo is
not), and the Mac-side Cowork VM has no network. So the push is one command
in Brendan's Terminal:

1. Claude edits files in the mounted folder `sos/` (device_bash / commit_files)
   and says what changed. Trap found 2026-09-17: `device_commit_files` with a
   `stagedPath` that was only `cp`'d into the outputs folder can write a STALE
   earlier copy of that path (the board page landed as the previous version
   while the docs beside it were current). Reliable path: `SendUserFile` on
   the file, then commit by `fileUuid`, then `md5sum` on the mount against
   the sandbox copy before telling Brendan to push.
2. Brendan runs, in Terminal:
   `cd ~/Documents/Claude/Projects/Symbiotic\ Operating\ System/sos && ./scripts/push.sh "what changed"`
   The script reads the PAT from `../pat.md` (gitignored, bare token or
   `SymbioticOS: <token>`), initializes git on first run, refuses to commit
   `pat.md`/`node_modules`, pushes `main`. Railway auto-deploys.
3. Claude watches the deploy with the Railway MCP (`list-deployments`,
   `get-logs`). Boot log shows `[registry] ...` lines for module imports.

If a future session does have the repo attached as a source, pushing from the
sandbox works the same way (`git push` from a clone) and the Terminal step
goes away.

The cloud sandbox has npm registry access (through its proxy) and Postgres 16
(`pg_ctlcluster 16 main start`, then create user/db `sos`/`sos`), so the app
runs there from a plain `npm install`: tar the repo without `node_modules`
and `.git` in the mounted folder, stage the tarball, untar, install, boot with
`SOS_FAKE_AGENT=1`. End to end and browser suites belong in `scripts/e2e/`
IN THE REPO (since 2026-09-19; the earlier ones lived only in a session's
sandbox and the next session could not rerun them); `bash
scripts/e2e/run-all.sh` runs every suite on the database and server it asks
for and prints one line each (2026-09-24; `quick` skips the browser suites). That is also where `package-lock.json` is regenerated
after a dependency change. The `node_modules` in the mounted folder is a stale
local install from before the SDK upgrade; Railway never sees it. The
sandbox can reach api.anthropic.com but has no key, so a real agent run is
tested on the live instance; a launch test with a bogus key (init message,
tool list, 401 from the API) proves the CLI itself starts.

## Live instance env vars (Railway service `SymbioticOS`)

- `SOS_WWW_KEY`: the shared key the anetix.ai service (`www/`) sends in
  `X-SOS-WWW-Key` on `/api/www/*` (any long random string, the same value on
  both services; unset = those routes answer 401). `SOS_WWW_URL`: the front
  door's address (default https://anetix.ai), used in the top-up link.
- `SOS_CONNECTION_KEY`: the key the ERP logins are encrypted under (any long
  random string; `openssl rand -hex 32`). Optional: without it the platform
  derives a key from SESSION_SECRET, so rotating that secret would make every
  stored login unreadable. Set it once and never change it without re-entering
  the logins.

`DATABASE_URL` (reference to Postgres), `ANTHROPIC_API_KEY`,
`SOS_FLOOR_PASSWORD`, `SOS_MANAGER_PASSWORD`, `SOS_ADMIN_PASSWORD`,
`SESSION_SECRET`, `SOS_MODEL_BASELINE` (optional: the first baseline,
`claude-fable-5-1` by default, until one is saved on `/admin#models`;
`SOS_MODEL_PROPOSE` / `SOS_MODEL_BUILD` / `SOS_MODEL_REVIEW` / `SOS_MODEL` /
`SOS_MODEL_INTAKE` are no longer read since 2026-09-22 and the admin page
names any still set), `SOS_MODEL_SUMMARY` (optional: the first model for the
short text jobs, Sonnet 5 by default, until one is saved on `/admin#models`), `SOS_ASSESS_RESUME_MS` (15000: how long after boot a head-to-head
that was running picks up again), `SOS_MAX_RUN_USD` (per
build run, default 1.50), `SOS_MONTHLY_CAP_USD` (default 25),
`SOS_FAKE_AGENT` (0/1). `SOS_FLOOR_PASSWORD` and `SOS_MANAGER_PASSWORD` are
now only the fallback for companies created before 2026-09-19 that have not
been given their own passwords (see the "one company per session" bullet);
`SOS_ADMIN_PASSWORD` is still the admin password. `SOS_MONTHLY_CAP_USD` is now
the instance-wide ceiling only; a company's own budget is set on the admin page
and lives in `platform.companies.monthly_cap_usd`. `SOS_PAGE_LOCK` (default
`on`) is the browser policy on module pages: `report` sends it report-only
(violations show in the browser console, nothing breaks), `off` sends none;
the escape hatch if module pages ever stop after a deploy. Optional: `SOS_AGENT_EFFORT` (build agent reasoning
effort, default `high`), `SOS_PERSON_IDLE_HOURS` (168) and
`SOS_PERSON_CAP_HOURS` (720): how long a name and PIN sign-in stays on a
device (it slides, see "Sliding sessions"; `SOS_PERSON_HOURS` is no longer
read), `SOS_APPROVAL_PIN_HOURS` (12; 0 off: an approval with a name whose PIN
is older than this asks for the PIN again), `SOS_BROWSER` (default `auto`; `off` makes
every build's page load go without a browser), `SOS_CHROMIUM_PATH` (where
Chromium is, when it is not on the PATH as `chromium`), `SOS_PAGE_SETTLE_MS`
(default 1500: how long a screen is given to load its data before it is
judged), `SOS_CHECK_TIMEOUT_MS` (default 10000, per check step),
`SOS_AUTO_PROPOSE_PER_HOUR` (default 40: how many requests a company's
proposer reads on arrival in an hour; past it they wait for the manager's
button),
`SOS_MODULE_RUNNER` (default `auto`; `process` = module code in its own
process or not mounted; `inline` = the old in-platform way),
`SOS_MODULE_TIMEOUT_MS` (30000, one module request),
`SOS_MODULE_LOAD_TIMEOUT_MS` (10000, routes.js load), `SOS_ROLE_CONNECTIONS`
(12, database connections per company role), `SOS_ROLE_STATEMENT_TIMEOUT`
(30s); `SOS_CONNECTION_KEY` now also keys the per-company database passwords,
`SOS_CONTEXT_CHARS` (default 400000: the most
module source a proposal, system review or diagram call is given; files are
whole below it, see "A model reads a module's files whole"),
`SOS_SESSION_IDLE_HOURS` (720) and `SOS_SESSION_CAP_HOURS` (4320; 0 = no cap):
the floor and manager cookie's windows, server-side, not just cookie Max-Age
(`SOS_SESSION_DAYS` is no longer read), `SOS_LOGIN_MAX_FAILS`
(default 10) and `SOS_LOGIN_WINDOW_MIN` (default 15) for the per-IP login
limiter (in-memory, address from `edge.clientIp`). Admin accounts:
`SOS_ADMIN_IDLE_HOURS` (168) and `SOS_ADMIN_CAP_HOURS` (720) for the admin
cookie (`SOS_ADMIN_SESSION_HOURS` is no longer read; take it out if it is
there), `SOS_CAMPAIGN_WATCH_MS` (5000: how often a walking test campaign's watches
are asked), `SOS_CAMPAIGN_MAX_ROWS` (200: the most rows a made-up test data set may
carry per table), `SOS_PROMPT_LOG` (a file every prompt is appended to as a JSON
line, data included: the data wall's canary test only, NEVER on the live
instance), `SOS_TRUSTED_DEVICE_DAYS` (30: how long "remember this computer"
skips the code), `SOS_ACCOUNT_MAX_FAILS` (5),
`SOS_ACCOUNT_LOCK_MIN` (15), `SOS_AUTH_EVENT_DAYS` (400), `SOS_ADMIN_2FA=off`
(break glass only), and `SOS_CONNECTION_KEY` is now REQUIRED before an
authenticator can be set up. Edge: `SOS_EDGE_SECRET` (the value the Cloudflare
Transform Rule puts in `X-SOS-Edge`), `SOS_EDGE_MODE=report` while proving the
rule, `SOS_CF_RANGES` if Cloudflare's ranges move. `SOS_ADMIN_PASSWORD` comes
OUT once the first authenticator is set up (never together with both of the
other two password variables: see `OPEN` under "Named admin accounts").
Passwords live only in Railway; never commit them.

## Hard rules

- Repo is private but treat it as clean-room: no Langmuir code, data, names,
  or branding. Nothing from the Finn Operations folder either.
- No em or en dashes in anything a participant reads (pages, proposals copy,
  runbook). Hyphens in compound words are fine.
- Module pages compute `base` from `location.pathname`; never hard-code
  `/m/paperline`, the same files serve at `/staging/m/paperline`.
- The manager gate is structural: nothing reaches a live module without a
  human approval. Do not add auto-deploy paths.
- A module's pages run under a Content-Security-Policy the platform sets
  (`registry.modulePagePolicy`), so a screen may only talk to its own module
  plus the feedback endpoint. When a module legitimately needs to reach
  something else, widen the policy there and add it to the gate's page rules;
  never let module code set its own security headers.
  Anything the policy opens is reachable by agent-written code with the
  session of whoever has the page open, a manager included. So a platform
  feature the widget needs on module pages gets routes of its own that are
  safe for any device of the company (`/who`), and its manager routes live on
  a path the policy does not open (`/people`). Never widen the policy to a
  prefix that also holds manager or admin routes.
- Every request below `auth.companyGuard` belongs to one company. A new route
  under `/c/:slug/` is scoped for free; a new route addressed by an id must be
  added to the `OWNERS` table in `src/auth.js` (its owning-company lookup) or
  it will be reachable across companies. A new route that names its company in
  the body scopes itself with `auth.ownsCompany(req, slug)`.
- A new platform table that belongs to a company goes in `backup.js`
  `PLATFORM_TABLES` and, if it holds secrets, stays out of `platform.companies`.
- A secret, a one-time code, a recovery code or a device token is never
  logged and never returned, apart from the one enrollment answer that shows
  a person their own (and the one Set-Cookie that hands a browser its device
  token). A new destructive admin action takes `auth.checkAdminCode`, and a
  trusted device never stands in for that code. A new route that moves a
  change toward the floor takes `people.requireFreshPin` after
  `requireManager`. A new admin
  route that an account with no authenticator must reach goes in
  `auth.ENROLL_PATHS`, and that list stays as short as it is. Anything that
  throttles, locks or logs by address reads it through `edge.clientIp`.
- Module code reaches nothing but `ctx`. The module gate holds agent builds
  and repo imports to the same rule. If a library module needs something new
  (hashing, a clock, an outside system), lend it on `ctx` in
  `registry.moduleServices`; never `require` it inside the module. Run
  `node scripts/test-modulegate.js` before pushing a change to `modules/` or
  to the gate.
- A file in `checks/` is a promise to the floor. No build, repo edit or agent
  ever edits or removes one that has shipped; a change adds the next number.
  The only way a promise ends is a manager retiring it on the board
  (`platform.check_retirements`). The platform's own checks of a staged build
  run as that company's manager (`auth.serviceCookie`), never with the
  internal token: the pages and the smoke list are agent-written.
- Reading a request on arrival never moves anything toward the floor: it
  drafts, folds, asks or flags, and the manager's gate is where it always
  was. A question goes only to the person who asked (or the device that sent
  a nameless request, by its token) and to the manager; `reply_token` never
  leaves `POST /api/feedback`'s own answer. The floor's side of it lives under
  `/who/`; the manager's answer, the unlink, the switches and the credit
  routes live on paths the module page policy does not open.
- Module server code runs in a process of its own per company (option C,
  `src/runner.js`); `SOS_MODULE_RUNNER=auto` falls back to running it inline
  when the instance cannot isolate it and says so on /admin. Do not undo the
  boundary: the child's environment is one variable it deletes on read (never
  add a second), its database login is `src/dbroles.js` (a new schema or table
  the platform makes needs `dbroles.grant` called again, which mountLive /
  mountStaged / restore already do), and a request reaches it WITHOUT the
  visitor's cookies. A platform feature a module needs is lent on `ctx` over
  the fork's private channel (add it to both `registry.moduleServices` and the
  child's `services()`), never by widening what the child can reach directly.
- Outside systems are connections (`src/connections.js`): declared in
  module.json, set up on the connections page, lent as
  `ctx.connections.<name>`. A new kind gets a surface there, its settings and
  secrets in `platform.connections` (secrets encrypted), a page policy
  addition only if a device-side program must be reached, and gate rules for
  its declaration. Never let module code hold a credential, a printer address
  or a file the platform did not hand it.
