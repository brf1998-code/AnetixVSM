# Anetix (Symbiotic OS): what is built, piece by piece

Moved out of `CLAUDE.md` on 2026-09-28 (the launch audit's 2.10: the working guide was over 200 KB). One bullet per
piece, in the words it was built in: what it does, why, the decisions, the tests and the known limits. A bullet is
history as of its date; a later bullet may change it (search its title). `CLAUDE.md` keeps the shape of the
instance, how to work, the live variables and the hard rules, plus an index of the titles here. Add a bullet for
anything new and a line to that index.

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
- **The admin page is seven tabs, one job each** (since 2026-09-28 the row is Demos (the default), Pins, Sites,
  Requests, Health, Companies, Accounts, Instance, and More for Library and Models: see "The launch audit's Phase 2";
  2026-09-21, `public/admin.html`; Pins and Demos added 2026-09-25, Sites 2026-09-26, ten now
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
  deployed (the old code read 0 as a zero-dollar cap). Since 0.5 (2026-09-27) the
  spend alerts stand in for a cap (`src/spendwatch.js`).
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
  Railway at once (until 2026-09-28: open is now `SOS_OPEN=1`, which a hosted instance
  ignores; see "The launch audit's Phase 2"). Admin actions in the interaction record still say "Anetix",
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
  refill is $30 for $10 since 2026-09-27 (`TOPUP_USD` 30, `TOPUP_CREDIT_USD` 10; was $20), so a refill is
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
  code at boot until an order is signed under it, then frozen; a new list price
  is version 2) and `platform.sites` (`id` uuid, the permanent id
  orders and Stripe will point at, since a freed slug goes to the next company
  with the same name; `company` unique; the facts, `deal` JSON, note, stage);
  both in the backup. Company delete takes the row and is REFUSED while a site is
  activating or subscribed (`sites.deleteRefusal`: end the subscription first,
  because the delete never talks to Stripe). Routes, admin only: `GET
  /api/admin/sites` (the book, the count per stage, a row per self-serve company
  or site row with its facts, band, pin holder, since, tools live, AI spent and
  the deal), `POST /api/admin/sites/quote { headcount, sqft }`, `POST
  /api/admin/sites/:slug` (the pipeline fields; the facts 409 while an order is
  open or signed, the note and the deal's own fields never)).
  The tab: the price book with a quick quote for a call, the stage counts, the
  pipeline table, and a form per row (one column on a phone, 16px boxes); a
  company that is not self-serve joins the pipeline once a field is saved for it
  and reads "Not ordered yet". Next: the go-live screens and the signed order on
  anetix.ai (stage 2), Activate and the rollover (3), the month to month (4),
  master agreements (5); `orders`, `customers` and `billing_events` arrive with
  the stage that uses them. Tests: `scripts/test-sites.js` (95),
  `scripts/e2e/sites.js` (32) and `sites-browser.js` (14), both in
  `run-all.sh`; `accounts-browser.js` counts ten tabs.
- **Paid sites, stage 2: Go live, as far as Signed** (2026-09-26,
  `src/golive.js`, `src/terms.js`, the go-live screens in the www repo;
  `docs/PAID-SITES.md` "Stage 2 as built"). A demo's manager answers four
  screens on anetix.ai (about the site, the price, who signs, sign), signs the
  order form and saves a card through Stripe Checkout in SETUP mode. **Nothing is
  charged; the site waits at Signed for Activate (stage 3).** It ships DARK:
  `platform.settings golive_open` is off until the admin switches it on from the
  Sites tab (the switch's confirm lists what is still missing); off, the board
  has no link and a customer's link is refused. Links are the product's: the
  manager's `<site id>.<exp>.<kind>.<mac>` over `golive:<kind>:<slug>:<site
  id>:<exp>` (kind m 31 days, kind a an admin's 24 hours), bound to the site's
  permanent id; the approver's `<exp>.<nonce>.<mac>` on `/order/<id>`, 14 days,
  the nonce kept on the order and checked again under the lock. anetix.ai hands
  the link back on EVERY call and the product checks it with the site's stage.
  Every change to a site's order runs in `withSite` (a lock on the `sites` row).
  `platform.orders` (uuid id, site_id, state draft/signed/activating/activated/
  declined/void, version, facts, band, price, price_book, terms_version and
  terms_sha256, approver, text and text_sha256, signer with `via`, signed_at,
  signed_ip with `signed_net` (the evidence: cf, real, xff, peer), setup
  session, payment method and card, stripe JSON, kind customer|preview,
  from_stage, note, voided_by); a partial unique index keeps ONE open order a
  site. `platform.terms_versions` keeps the words of each terms version at its
  first signature, and a later signature over other words is refused (503).
  `platform.sites` gains `billing` and `stripe_customer` (unique, one Customer a
  site). Rules: signed is what was shown (the version and the SHA-256 of the text
  must both match; the text carries the billing email and the learning opt-in,
  which the terms lean on); the first card wins and any other is answered detach;
  a customer order's answers write through to the site row; the Sites tab's facts
  lock while an order is open (the note, approval limit and master agreement stay
  editable; a save with unchanged facts goes through). PREVIEWS (the review of
  2026-09-26): an admin's link makes kind preview orders that never move the
  site's stage, never write to its facts, never show on the customer's board or
  page, and save their card to a Stripe Customer of their own; an admin's link on
  a customer's order is read only; a customer's first answer voids an open
  preview and anetix.ai detaches its card. Withdraw (`POST
  /api/admin/sites/:slug/void-order { note }`, the Sites tab) voids an open order;
  a customer's site goes back to its stage before the order and the manager sees
  the note. A card Stripe holds for a withdrawn order or a deleted company is
  `orders.stripe.detach_pending`, listed on the Sites tab until stage 3 removes
  it. Price book 1 freezes once an order is signed under it. The board's credit
  line and out-of-credit panel and a Settings card carry the link
  (`forBoard`, managers and admins of a demo only); signed, one line says the
  order is in. Routes: `/api/www/golive/{view,save,approver,sign,checkout,
  start-over,card,terms}` (the shared key), `GET|POST /api/admin/golive`, `GET
  /api/admin/sites/:slug/golive-link|orders`, `POST .../void-order`, `GET
  /api/c/:slug/golive` (requireManager). Tests: `scripts/test-golive.js` (52),
  `scripts/e2e/golive.js` (99, in `run-all.sh`); with the www service up:
  `www/scripts/e2e-golive.js` (55) and `e2e-golive-browser.js` (26).
- **Paid sites, stage 3: Activate, the rollover, the Terms** (2026-09-26,
  `src/activate.js`, `src/agreements.js`, `src/fairuse.js`, `src/notices.js`, a
  new `src/terms.js`; www's `internal.js`; `docs/PAID-SITES.md` "Stage 3 as
  built"). Go live STAYS OFF until stage 4 (Cancelling, the portal, Back to demo).
  **The channel**: the product never holds the Stripe key; Activate calls
  anetix.ai's second listener over Railway's private network
  (`WWW_INTERNAL_URL`, e.g. http://anetix-www.railway.internal:4001, header
  `X-WWW-Internal-Key` = `WWW_INTERNAL_KEY`, the same on both services; no key,
  no listener). `activate.channel()` pings it (Stripe test/live/fake, Tax on or
  off; cached 30 s for the Sites tab, fresh for Activate). **Activate** (Sites
  tab, `POST /api/admin/sites/:slug/activate { code, tenancy_note, clear_sample,
  test_mode_ok }`): checks (`GET .../checks`: channel, the AI key's auto reload
  noted on, tool isolation from the second paying site (the tenancy note went on
  2026-09-27, see "The launch audit's C items"), size flags, the plan,
  the refund due, `test_mode`, `tax_off`); a customer's order while Stripe is not
  live needs `test_mode_ok`; a preview runs in test mode only. Under
  `golive.withSite`'s lock the order and site go to activating, the unused bought
  credit is frozen per card, then www: resume by `metadata.order`, default card,
  the balance credit (`metadata anetix=demo_credit`), the Price by lookup key
  `anetix_site_<band>_v<book>_<cents>`, the subscription (`off_session`,
  `error_if_incomplete`, key `anetix-sub-<order>-<pm>[-t<n>]`). A card error
  answers 402 `{ declined, balance_reversed, balance_txn, detached }`: order back
  to signed without a card, site to ordering, a `card_declined` notice.
  Anything else leaves it activating with the error; Activate again carries on.
  `POST .../stop-activating { code }` asks www `/internal/abandon`: a
  subscription found finishes the rollover, else reverse, detach, ask for a card.
  **Rollover**: `finish()` (order activated, site subscribed with period, band,
  price, learning, `converted_at`), then `rolloverSteps` under a pg advisory
  lock, each step marked on `sites.rollover` (sample data out, the floor's own
  password into `welcome_enc` for the manager's once-only board panel, `demo`
  false and the site's name); `finishPending` at boot and every 15 minutes; the
  first `invoice.paid` finishes an order whose answer was lost. `collectWelcome`
  refuses (410 `stale`) a password that no longer opens the floor, and a new
  floor password on the company card clears the welcome. **A paying site**: no
  credit, no company or instance cap (`agent.subscribedSite`), the fair-use line
  instead (`fairuse.assertUnder`, 429 `fair_use`, the spec's words, logged
  `fair_use_reached` once a period; `opts.fairUse` on new starts: a proposal on
  arrival, confirmRequirement, a queued build, intake rounds and design;
  `opts.started` lets started work finish; `ctx.ai` is `runtime` and never
  paused); `POST .../lift { note }` until the period ends. Settings has the
  subscription card and the learning switch (`POST /api/c/:slug/learning`,
  manager only, the Terms 10.2). The Demos tab stops at `converted_at` without
  the opt-in (rows changed after it are redacted). The head-to-head and the
  checks replays leave paying sites out. **The Terms, 9.1**: `importFromRepo`
  holds a repo change for any company but the manifest's own (`demo`);
  (the rest of this sentence was taken out on 2026-10-14, see "No reason asked when Anetix changes a tool")
  an admin deploy, rollback or goto on a customer needs `admin_reason`
  (security | broken | asked) and `admin_note`, and the manager gets a
  `tool_changed` notice (`feedback.adminChange` / `tellManager`, which never
  fails the change); a restore with paying sites asks the same, notices every
  paying site in the restored data, and refuses a file older than a site's
  subscription unless `sites_ok`. **Stripe's events**: www re-reads the
  subscription for invoice and subscription events and posts
  `/api/www/billing-events`; the period moves the fair-use window, the standing
  is kept, a subscription Stripe cancelled sets `sites.attention`; what a
  standing does is stage 4. A refill for an activating or subscribed site is
  answered 409 `subscribed` and www refunds it (`anetix-refund-<session>`); a ref
  credited before is always `added:false` first. **Cards**: every card that will
  not be charged goes on `orders.stripe.detach_list` (the stage 2
  `detach_pending` still read); `activate.tidy()` detaches them and reverses a
  left balance credit at boot, every 15 minutes and on `POST
  /api/admin/stripe-sweep`. Decline (`{ reason }`) and Send back (`{ note }`) for
  a signed order; the customer's Withdraw at `POST /api/www/golive/withdraw`.
  **The Terms**: Brendan's text as `termsDoc()` format 2 (summary plus 21
  sections), `TERMS_VERSION` `draft-2`, `WORDS` for every box; the switch
  `terms_live` (`GET|POST /api/admin/terms`, off); `platform.acceptances` (order,
  demo_setup, topup, board; version, SHA-256, words, who, ip and its evidence,
  ref; `gone_at` on delete, never removed); with the switch on a demo without an
  identified acceptance (demo_setup, board, order) waits for its manager's tick
  on the board (`POST /api/c/:slug/terms/accept`); `/terms` was behind the wall
  (public since 2026-09-27) and the product's links carry `?k=` (HMAC over
  `terms:<exp>` under `SOS_WWW_KEY`, 31 days). `backup.restore` merges `acceptances`,
  `billing_events` and `terms_versions` instead of replacing them. The delete
  confirm shows the refund due under 4.2 (`GET
  /api/admin/companies/:slug/refund-due`). Tables: `acceptances`, `notices`,
  `billing_events` (in the backup), columns on `sites`. Tests:
  `scripts/test-activate.js` (26), `scripts/e2e/stage3.js` (116, a stub channel in
  the test; in `run-all.sh`); www `test-www.js` (87), `e2e-activate.js` (42).
- **The launch audit's C items** (2026-09-27; the audit is a Claude Doc, the
  project doc `claude/launch-readiness-audit-2026-09-26.md` links it). (1) **The
  Terms are in effect**: `TERMS_VERSION` `2026-09-27`, not a draft; the brackets
  filled with Brendan's best guess (legal email brf1998@gmail.com, 34 Lee St,
  Cambridge, MA 02139, https://anetix.ai/terms, https://anetix.ai/privacy); 16
  pauses AI only for overdue Fees; 10.6 says an export is data, not Tool code.
  `/terms` and a new `/privacy` (www `privacy.js`) are PUBLIC on anetix.ai. (2)
  **Who to write to**: brendan@anetix.ai or taylor@anetix.ai on the wall, the
  request pages, /welcome, both sign-ins and the code step (`login.html`), the
  authenticator setup, Settings (a Help card), the out-of-credit panel; www's
  `WWW_CONTACT` defaults to both. (3) **The price before the form**:
  `sites.fromLine(book)` ("Sites start at $1,000 a month, for under 50 people.")
  on the pin holder's front page, beside the board's Go live link
  (`golive.forBoard().from`) and in Settings. (4) **"That's me"** fills an empty
  plant manager name and email from the demo's own email and name, server side
  and in the form. (5) **The company's data** (`src/dataexport.js`): `GET
  /api/c/:slug/export` (manager, an admin too; "Your data" in Settings) is one
  JSON file: each tool's tables (bytea as base64, `_` tables left out), requests,
  intake answers, attachments (base64 up to 15 MB each and 60 MB in all, the rest
  listed), uploads, print jobs, people, managers, the human rows of the record,
  the site's facts; never code, versions, proposals, the agent's or platform's
  record rows, hashes or tokens; one export per company at a time. A daily sweep
  deletes demo requests and never-used pins over 12 months old unless they led
  to a demo; `idle()` lists companies 11+ months without a sign-in on the Demos
  tab; company delete takes the demo request and the pin. (6) **Tenancy**: no
  note at Activate; `activate.isolation()` refuses a second paying site only
  while module code is not isolated on this instance. (7) **Stage 4 and the
  alerts**: `src/billing.js` and `src/notify.js`, see `docs/PAID-SITES.md`
  "Stage 4 as built" (Manage billing, past due, unpaid and `canceled_at_stripe`
  pausing AI, cancel dates, back to a demo with `self_serve.credit_since`, End
  after 30 days unpaid, ntfy alerts). (8) **Module redirects**: `registry.lockDown`
  drops a `Location` that leaves the module's own mount, and any `Refresh`, so a
  module route cannot bounce its page's fetch onto the manager's own routes.
  Tests: `test-billing.js`, `test-lockdown.js`, `e2e/billing.js`,
  `e2e/dataexport.js`; www `test-www.js`, `e2e-activate.js`.
- **The launch audit's Phase 0** (2026-09-27, the items before the next pin; the audit is the Claude Doc the
  project doc `claude/launch-readiness-audit-2026-09-26.md` links). (1) **One bad request never stops the product**
  (`src/errors.js`, 0.1). Found 9/26: any signed-in session opening `/api/runs/abc` ended the process (Express 4
  does not catch an async route's rejection; the database refused NaN; Node exits on an unhandled rejection).
  `errors.asyncRoutes()` patches `express/lib/router/layer` so a route's rejected promise goes to `next(err)` (Express
  5 does this itself; `src/runner-child.js` carries the same lines for module code); `errors.handler`, mounted LAST in
  server.js after `app.use("/api", errors.apiNotFound)`, answers JSON (a page only for a browser GET outside `/api/`),
  400 for a malformed value (Postgres 22P02, 22003 and friends), a bad JSON body or a broken % code, 413 for too
  large, else a 500 that names nothing inside and says who to write to; a 500 is logged with its stack and sends one
  ntfy alert ("Product error", the route's shape with numbers blanked and the error's class and code, never its
  message), at most one per 15 minutes (`SOS_ERROR_ALERT_GAP_MS`) with a count of the rest. `errors.guards()`: an
  unhandled rejection or uncaught exception is logged and alerted and the process goes on; more than 30 uncaught
  exceptions in a minute exits (Railway restarts it); rejections never count. `db.js` listens for the pool's
  `error` (an idle connection Postgres dropped used to end the process), and a failed `listen` exits. Every id
  parameter on every route is `(\\d{1,9})`, so `abc`, `0x10`, `1e3`, `1.5` and twenty digits match no route and get a
  plain 404. (2) **Found doing 0.1, the worse one: `auth.companyGuard` was case-sensitive and Express routing is
  not.** A manager of one company read another's board, downloaded its data export and +1'd its requests with
  `/API/C/<other>/...` or `/api/feedback/0x1/plusone` (confirmed on the live code, 30d15c8). The guard's patterns are
  case-blind now, the id routes take digits only, and an id past the column's range is 404 in the guard. A reviewer
  then tried 31 more spellings (`%62`, `%2F`, `;`, dot segments, double slashes, `010`, `%00`) against the real guard
  and routing: all refused or unrouted. (3) **Pins say why and where to go** (0.3, `selfserve.pinReason`,
  `PIN_WORDS`, `refusalFor`, `logRefusal`, `platform.pin_refusals`). A used pin typed with the email it was made for
  answers `{ reason: "used", signin: <that demo's manager login exactly> }` and anetix.ai opens Sign in with the
  login filled; with another email it says only "already been used". Expired and cancelled say to ask at
  anetix.ai/request or write to Brendan or Taylor, and the link under the pin box reads "Request a new pin" (with the
  email). Every refusal is a line on the Pins tab ("Pins refused": when, the pin and email typed, the pin's label,
  why, where: the pin box, a pin page opened again, before a checkout); the same pin, email, reason and place within
  ten minutes is one line with a count, and made-up pins from one address merge into one line. anetix.ai passes the
  visitor's address and allows twenty tries a quarter hour per address at the pin box. Kept 90 days
  (`dataexport.sweepDemoRequests`), never in a backup, named in the privacy notice (www `privacy.js` 2026-09-27.2).
  (4) **The caps in plain words** (0.5, `agent.CAP_WORDS`): the instance cap and a company's own budget answer 429
  "AI work is paused for now ... Everything you built stays and keeps working ... Write to ..." with no dollars and
  no variable names; the figures go to the log (`[cap]`) and one ntfy alert a month per cap ("AI cap reached").
  (5) anetix.ai: one line on the wall saying what is sold (0.6, `pages.WALL_LINE`, Brendan's to reword) and refill
  Checkout Sessions take a card only (0.7, `stripe.sessionParams`). Tests: `scripts/test-errors.js` (30),
  `scripts/e2e/badids.js` (33: the repro, every route with a parameter found by walking the routers and called with
  nine bad values as manager, floor and admin with the server's boot id checked throughout, and another company by
  every spelling), `scripts/e2e/caps.js` (7, started with `SOS_MONTHLY_CAP_USD=5`), `scripts/e2e/selfserve.js` (111),
  `test-selfserve.js` (51); www `test-www.js` (100), `e2e.js` (60). Brendan did 0.4 and 0.8 the same day; 0.9 waits
  for real customer sites (until then he pushes whenever). (6) **Spend alerts, not a spend limit** (0.5, Brendan:
  "if we expand quickly we could fall behind and then have everyone fail ... I just want notifications if we are
  rapidly blowing past limits"; `src/spendwatch.js`). `SOS_MONTHLY_CAP_USD` stays unset and nothing is refused. Every
  ten minutes (and 30 s after boot) the meter (`platform.ai_calls`) is read and ntfy alerts go out for: over
  `SOS_ALERT_HOUR_USD` (15) in the last hour; one company over `SOS_ALERT_COMPANY_HOUR_USD` (8) in the last hour; over
  `SOS_ALERT_DAY_USD` (60) in 24 hours; the last 24 hours at `SOS_ALERT_PACE_X` (3) times the average day of the week
  before, once they reach `SOS_ALERT_PACE_MIN_USD` (15) and the meter has two days of history; each
  `SOS_ALERT_MONTH_STEP_USD` (250) of the month. 0 turns a rule off. An hour rule keeps quiet 3 hours (per company),
  the day and pace rules 24, a month step for good; what was sent is an event (`spend_alert`, ref = the rule's key)
  so a restart never repeats it. The Instance tab's Phone alerts card shows the rules, the spend now and the last
  alert; `POST /api/admin/notify/spend-check` (admin) runs the check at once. Tests: `scripts/test-spendwatch.js`
  (15), `scripts/e2e/spendwatch.js` (11, started with `SOS_ALERT_MONTH_STEP_USD=25`).
- **The launch audit's Phase 1** (2026-09-27, what a first-time demo manager meets; Brendan's calls: passkey first on
  phones (1.3), keep all 12 intake questions (1.7 not built: "I want them to be impressed at how good it is for their
  use case"), a demo build stopped before a preview gets its credit back "but these absolutely need to be addressed"
  (1.20)). (1) **Passkey first on phones** (1.3, `src/accounts.js`, `src/passkeys.js`, `public/enroll.html`). A
  manager on a phone (coarse pointer, screen under 820) is offered "Use Face ID" (or the fingerprint or screen lock)
  first and the authenticator app as the other way; on a computer the app comes first with the passkey as a link.
  `enrolled` is the app OR (manager AND a live passkey). The first passkey of a manager with no app makes the ten
  recovery codes (`accounts.passkeyEnrolled`, also whenever such an account has no unused code left) and logs
  `enrolled` with `factor: passkey`. `auth.managerEnrollPath` lets the enrolment session reach
  `/api/me/passkeys/options` and `/api/me/passkeys`. For such an account a password sign-in answers
  `{ need_code, passkey_first }` (passed through by `auth.loginHandler`): the password alone is never enough, a
  recovery code stands in (no "remember this computer"), and login.html and the anetix.ai wall say "This account
  signs in with its passkey". The last passkey of a manager with no app cannot be removed (409; checked and removed
  in one transaction on the account row, and the session cache forgotten). Settings' "Your sign-in" card: the
  passkeys, the app (with "Add the app", `/c/<slug>/enroll?app=1`), and Change my password (signs out everywhere).
  (2) **The board's first ten minutes** (1.4 to 1.9, `public/index.html`). A manager's board with no tools shows
  "Build your first tool" (`renderFirstTool`); a new-tool request (feedback `kind='module_request'`, module NULL
  until named) is a card in its status column whatever the filter, never under Requests to Anetix;
  `POST /api/c/:slug/intakes` reopens the company's unfinished request (answering, failed, thinking, design) instead
  of making another (`reopened: true`; the credit is still asked). Customer text says tool, not module (board, intake
  popout and its errors and questions, Settings, the diagrams page; the server writes "New tool: <name>" and screen
  "New tool request"; the board reads "New module: " on old rows too). Plain step labels (`STEP_LABEL`); the gate's
  checks line is one plain sentence with the counts and the second review's words folded under "What was checked";
  a demo company's gate button is "Make it live". On a phone the board opens the column that waits on the manager
  (`attentionCol`: a build waiting or stopped, a request at answering, design, confirmed or failed; else Reviewing;
  else the first column with cards) until they tap a tab, and a new thing waiting moves the view once more; the
  Feedback button docks in the band (`feedback-widget.js` `data-dock="#fbdock"`, phones only) instead of floating over
  the cards. (3) **The bare sign-in** (1.12): `/login` with no company in the link opens the account form, with "Sign
  in with the floor's shared password instead"; "Floor and manager passwords both work here" is gone. (4) **What a
  restart leaves** (1.13, `src/restart.js`). At boot, after the build and campaign sweeps: a new-tool request the AI
  was reading goes to failed ("Open it and try again" sends the answers again), one redoing its design goes back to
  that design with a line that the edit was not applied, and a running review, diagram drawing or brand guide goes
  to failed. SIGTERM: the listener closes, answers carry `Connection: close`, the build agents talking are stopped
  and marked as cut off by the restart, nothing new starts from the queue, then the tool processes and the pool go
  (at most `SOS_DRAIN_MS`, 25 s). railway.json sets `drainingSeconds: 30` (Railway's default is 0: SIGKILL at once).
  **The fence**: Railway starts the new process while the old one still runs. `sweepOrphans` stamps every running
  build with its own boot (`build_runs.fence`, the boot's start time) and from then `pipeline.setRun` and `log`
  refuse (a `fenced` error, which `failRun` lets go and the error handler answers 503 "Anetix is restarting") a
  write from an older process. A run a process sets running (or inserts) carries its stamp, and the sweep runs again
  three minutes after boot (`SOS_LATE_SWEEP_MS`) for what an older process started after the boot sweep. A fixed
  numeric `SOS_BOOT_ID` in the variables would turn the fence off: do not set one. `/health?deep=1` also asks the
  database. (5) **The board through a restart** (1.14): a 5xx or no answer shows "Anetix is restarting or the
  connection dropped" and keeps the board (it used to become "Unknown company."); anetix.ai says "Anetix is
  restarting. Try again in a minute." (`www/server.js sos()`, code `restarting`) and the wall's sign-in says so
  before sending anyone to the product's own sign-in. (6) **Phone alerts** (1.15, `notify.notifyEvery` throttles
  per key with a count): a demo request (company and size), a new demo, refused pins (the reason only, never the pin's
  label), a locked account (the kind and company, never the email), a demo build stopped before a preview, the AI
  service refusing, a request to Anetix (company and screen, never the words), a tool process restarted; anetix.ai
  sends its own (`www/notify.js`, same `NTFY_TOPIC`) for a Stripe event it could not apply. Each service watches the
  other (`src/uptime.js` asks anetix.ai's `/health`, `www/uptime.js` asks `/health?deep=1` here, every minute; three
  misses send one alert, the first answer after sends "answers again"); both on Railway, so an outside checker on
  `https://app.anetix.ai/health?deep=1` is still worth having. (7) **A hung tool process** (1.16, `runner.timedOut`):
  each request that runs out of time is logged and an event (`tool_timeout`, the route's shape); `HANG_LIMIT` (3,
  `SOS_MODULE_HANG_LIMIT`) in five minutes on two or more routes, or five on one, restarts the company's process for
  that lane (`tool_restarted`, an alert). (8) **Trials are Anetix's** (1.17): `ai_usage` kind `assess` stays under the
  company whose work it was (so /admin#models can say whose) but no longer counts against its credit, its own
  budget, its fair-use line or the Demos tab's spend; trial calls are metered as `assess:<kind>`
  (`agent.withMeterTag`) and fair use leaves those out; a trial checks the instance cap only. (9) **Settings is the
  company's, agent settings are Anetix's** (1.18): Settings reads `GET /api/c/:slug/settings-view` (company switches,
  tools, the manager's sign-in, no models); `/c/:slug/agents` and its API are admin only. (10) **A demo's diagrams
  when asked** (1.19): no drawing after a demo's deploy or at boot; the Diagrams page offers "Draw them now" (the AI
  gates a start passes, one at a time, not again within ten minutes); the diagrams API names no model and no cost to
  anyone but an admin. (11) **A demo build that stops before a preview** (1.20, `src/demostops.js`,
  `platform.demo_stops`): a stop with no preview to open (`hadPreview`: failed while building or writing the
  requirement, or by the platform's own gate) in a demo company hands its spend back as credit (an `adjust` ledger
  row; a later stop of the same run only what it spent since, the rows here being the record; never an overrun
  write-off), is listed on /admin Demos ("Builds that stopped in a demo", the tab dot red while any is open) until an
  admin marks it addressed with a few words, and sends an alert. The stopped card tells the manager the credit came
  back (never the amount). Fake agent marker `FAILBUILD` stops a build partway with $0.42 on it. Tests:
  `scripts/test-phase1.js` (18), `scripts/e2e/phase1.js`, `scripts/e2e/phase1-browser.js` (19, a phone at 390x844),
  `scripts/e2e/passkeys-browser.js` (44, the phone that turns on its screen lock and never sets up the app); board,
  checks and campaign browser suites read the new words; www `test-www.js`, `e2e.js` (the restart wording).
- **Phase 2's first item: no model names and no AI costs in what a company reads** (2026-09-27, Brendan: "incorporate
  the two model name leaks in the phase 2 build"). The pages never showed them; the JSON behind them did (the board's
  runs, proposals, reviews, credit dollars, spend and cap figures, the new-tool popout, the record and its export, a
  run on its own), and so did the checks log page and a tool's own AI (the Plant KPIs tool's Jonah printed "Opus 5.5 ·
  $0.012" and a model picker with prices). `src/companyview.js` is one middleware, mounted right after
  `auth.companyGuard`: every `/api/` answer to a manager or floor session goes through `scrub()`. A key that carries
  an AI cost (`COST`: cost_usd, costUsd, sdk_cost_usd, estimate_usd, spend, maxRunUsd, maxBatchUsd, cap_usd,
  monthly_cap_usd) is dropped; `refunded_usd` becomes `refunded: true`; a key that names a model (`MODEL`: model,
  models, proposal_model, models_seen, review_model, arm, ab, model_propose/build/review) is dropped when what it holds
  names one, so a tool's own "model" column (a machine's model) stays; the platform's own gate keeps its fact as
  `cross_check.platform: true` (index.html reads it); a demo's credit becomes `{ percent, level, line, topup_url, out }`
  (index.html reads `out`); a string naming a model (an id `claude-<family>-...` in any case, a label as written,
  "Opus 5.5") says "the AI", and the cost cap and safety budget lines lose their figures. An admin, anetix.ai's key
  (no session role), a tool's own routes (`/c/<slug>/m/...`), the connections routes (a spreadsheet's columns may be
  called model or cost_usd) are never touched. The data
  export scrubs its requests and record, never the tools' rows or the new-tool answers. The checks log (page and its
  API: list, label, replay, export) is admin only, like the agent settings (1.18); a review's cost estimate is admin
  only; a manager's `model` in approve, batch or review start is not read. A system review's cards are named "System
  review #N" (the model stays on `platform.reviews`) and its brief no longer lists each run's model and cost. **What a
  tool is lent for AI** (`registry.moduleServices` `ai`, and the spec `src/runner.js` hands a tool's process):
  `models` is `LENT_MODELS` (one choice, `{ id: "standard", label: "Standard" }`), `modelFor()` answers "standard",
  and `chat()` picks the model itself and answers `{ text, model: "standard", costUsd: 0 }`; the usage rows and the
  record keep the real model and cost. The Plant KPIs page hides its picker when there is one choice and shows no cost.
  Tests: `scripts/test-companyview.js` (17), `scripts/e2e/leaks.js` (makes proposals, a shipped build, a stopped one,
  a review, a new-tool request, a log line naming a model and a cost cap; then calls every GET route that takes a
  parameter, found by walking the routers, as a manager and as the floor, and reads each answer for a model's id or
  label, a cost key, any `*_usd` but a price and any `$` figure; the admin's copy still has them; Jonah as a manager).
  **A tool's code is Anetix's** (the same night, Brendan: "a manager should be able to download data but not the tool
  code, the tool code is owned by us"): `GET /api/c/<slug>/modules/<name>/export` (one version's files) is admin only;
  no UI called it. A manager keeps Settings' "Your data" (`src/dataexport.js`, never code) and what the board and
  Versions panel show (file names in "what changed?", titles of the checks, the plain summaries). `leaks.js` checks
  the 403 for a manager and the floor, the admin's copy, and that the data export carries no code.
- **The outside check** (2026-09-27, `ops/outside-check/`, the launch audit 1.15's optional outside checker; Brendan:
  "an optional outside checker that can verify for me and notify me"). A Cloudflare Worker (`worker.mjs`, pasted into
  the dashboard; setup in its `README.md`) on a one-minute Cron Trigger, outside Railway, sending to the same
  `NTFY_TOPIC`. It asks `app.anetix.ai/health?deep=1` (up, database, version, boot), `app.anetix.ai/login` (the path
  through Cloudflare's edge rule, which `/health` is exempt from; a 403 there names the rule), `anetix.ai/health` and
  `anetix.ai/`. A failure is asked twice more 15 s apart before it counts; one that answers on a retry is a short miss.
  It says: that it is running (the first run, with what it saw), what is not answering (one alert, then hourly), what
  answers again (and after how long), a new version on either service ("is on <sha> now": a push confirmed from
  outside), a restart with no new version, and a quiet morning line at `SUMMARY_HOUR_UTC` (12). State is one KV key
  written only on a change. Both `/health` answers now carry `v` (the first 7 of `RAILWAY_GIT_COMMIT_SHA`, null
  locally) and `boot` (the product had it; anetix.ai's is new). Tests: `scripts/test-outside-check.js` (24, no
  network), `phase1.js` and www `e2e.js` read the new `/health` fields. Known limit: KV can be a minute behind between
  Cloudflare's locations, so a transition may rarely be said twice.
- **anetix.ai's front page crash, and its own error guard** (2026-09-27, found running www's `e2e.js` for the outside
  check). The $30 refill change (6998d6f) declared `const money = { ..., money(...) }` inside the `/` route, so every
  visit with a good pin threw inside an async route, which on Express 4 and Node 22 ends the process (no pin holder had
  opened it since the deploy). Renamed, and www got `errors.js` (the product's `src/errors.js` pattern: async routes to
  `next(err)`, a plain 500 page, one alert per 15 minutes, guards on stray rejections). Its `e2e.js` and
  `e2e-activate.js` still expected the $20 refill; both now read $30 (the unused bought credit refunded at Activate is
  $30, the first invoice $2,470). Run the www suites after any www change: they are what caught it.
- **The launch audit's Phase 2: cleanup, admin and the guide** (2026-09-28; the audit is the Claude Doc the project doc
  `claude/launch-readiness-audit-2026-09-26.md` links; Brendan: "I am good with the full build of phase 2"). The week
  needs Demos, Pins, Requests and Sites; the rest of /admin was folded, nothing underneath removed. (1) **A demo is
  not a red flag** (2.1, `coFlag` and `accessText` in `admin.html`): an accounts-only company reads "a demo: no floor
  password (...)" and has no Set passwords button; "still on the shared passwords" is only a `legacy_login` company,
  "sign-in needs setting" only a company with no accounts and no passwords of its own, and a non-demo with accounts
  and no floor password gets an amber "no floor password yet". (2) **One spend formula** (2.2, `agent.SPEND_SOURCES`,
  `spendSince`, `monthlySpend`): build runs, proposals, reviews, brand, `ai_usage` (every kind) and diagrams, one
  UNION used by the company list and card (`overview`), loop health and a company's own budget; `assess` counts in
  the instance's total and never in a company's. (3) **Demos first** (2.3): the tab row is Demos (the default), Pins,
  Sites, Requests, Health, Companies, Accounts, Instance, then More (Library and Models, `more: true` in
  `admin-shell.js`, the toggle `data-more`); the Pins tab's Self-serve companies card is gone and pin and demo request
  links go to `#demos/<slug>`; a Demos row carries Grant credit and "Seen, clear it". (4) **Experiments folded** (2.4):
  a company card keeps Go to, Modules, Sign-in, the AI credit, Agent docs and the Danger zone in view; Add a tool, AI
  budget and models, Test floor, What the AI reads and Brand sit in `details.comore` (closed; `CO_MORE` keeps one
  open across a redraw); Add a company by hand is a quiet link; the Models tab folds the head-to-head and the live
  A/B under `#am-more` (open while either runs). (5) **Pills only when they want a look** (2.5, `drawPills`): the AI
  spend and Models pills are gone, the rest show only amber or red, the instance credit pill reads "Anthropic key",
  and a demo out of credit is the red "Out of credit" pill to `#demos`. (6) **Go live's switch is quiet** (2.6):
  "Switch it on for customers", a quiet button whose confirm lists what is open. (7) **Stale words** (2.7): backup,
  auto reload (Anthropic's word), where the ledger lives, the shared admin password line. (8) **One pin message**
  (2.8, `selfserve.pinMessage`): "Make the pin" by hand and "Make their pin" from a demo request both answer `{ pin,
  subject, message }`; the message has the pin, the email it is for, the link, how long, what to have ready (Face ID
  or a fingerprint, or an authenticator app), how to come back later and brendan@anetix.ai or taylor@anetix.ai; the
  Pins tab shows it with Copy and Open in email. (9) **Who is stuck and what happened lately** (2.9,
  `demos.stuckOf` pure, `demos.activity`, `GET /api/admin/demos` answers `stuck` and `activity`): a locked manager
  account, a build stopped and not started again, out of credit (kept on the list marked seen), the sign-in not set
  up an hour after coming in, signed in and nothing started after a day, a live pin unused for two days; in that order
  (`STUCK_ORDER`), a paying site never (the Sites tab's). Recent activity: 14 days of demos coming in, sign-ins,
  requests filed, new tools confirmed, deploys, refills and demo requests; a paying site without the learning opt-in
  stops at `converted_at`. (10) **This file** (2.10): the feature history moved here from CLAUDE.md, whose variable
  lines were wrong (the connection key, the caps, the admin password, the open rule). (11) **No browser, an alert**
  (2.11, `pageload.noBrowserAlert`): on Railway, a boot with no Chromium or one that will not start sends one ntfy
  alert; since 2026-09-28 railway.json says RAILPACK and railpack.json installs Debian's Chromium (it was Nixpacks
  and nixpacks.toml until then; see "Built with Railpack"). (12) **Open is a switch production never honours** (2.12, `auth.HOSTED`, `auth.OPEN`):
  no password variables no longer means open; `SOS_OPEN=1` opens a local instance, and never one on Railway or with
  `NODE_ENV=production`; `.env.example` boots closed. (13) **The models test waits for the reload** (2.13,
  `models-browser.js`). (14) **Two companies' tools never share tables** (2.14, `migrate.schemaClash`,
  `freeToolSlug`): acme + north-scrap and acme-north + scrap made the same schema name; a new tool's slug takes the
  next free one (`-2`) when named, a module build refuses a clash, and adding a library tool answers 409 naming the
  other company and tool (other companies' open new-tool requests count). (15) **The Anetix mark as the tab and home
  screen icon**: `/favicon.ico` (16, 32, 48), `/apple-touch-icon.png` (180, square), `/manifest.webmanifest` (192,
  512, a maskable 512) on both services; every product page links them, the board's home screen icon is the
  company's (`/api/c/<slug>/icon.png`: the brand icon when it is a PNG or JPEG, else the mark). Tests:
  `scripts/test-phase2.js` (17), `scripts/e2e/phase2.js` (21), `scripts/e2e/phase2-browser.js` (20), all in
  `run-all.sh`; `phase1.js` checks the icons, www `e2e.js` too; the browser suites that read the tab row, the pills
  or the company card follow the new layout.
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
  (`actor_person`, next bullet), and which named account since 2026-10-15 (`actor_account`, "The record says
  which account acted"). Not recorded yet: a proposal's rationale edits. What it feeds next:
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
  `railpack.json` (`deploy.aptPackages`, Debian's `chromium` at
  `/usr/bin/chromium`; Nixpacks and `nixpacks.toml` until 2026-09-28, see
  "Built with Railpack"); found on the PATH or at `SOS_CHROMIUM_PATH`; it runs `--no-sandbox`
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
- **The record says which account acted** (2026-10-15, Brendan: Chelsea Clock's record export had 718 rows, the 545
  answers to its BOM request and every approval, deploy and close-out among them with no name, so it could not say
  whether Jackson, Arthur or Taylor had done what). The 2026-09-26 fix above named the account on a filed request only.
  Now `record.actor(req)`, which nearly every request path already uses, also carries the named account behind the
  session (`account`, `account_name`: `req.sosAccount.id` and its name, else its login). `record()` writes the account's
  name as `actor_name` when no person is signed in on the device and no name was passed, and the account's id in
  `platform.record.actor_account` (new column, added at boot) on every row made from a named sign-in. `actor().name` is
  unchanged on purpose: callers show it to the company (a close-out's "by" stays "The manager" or "Anetix"), so this
  changes the record and nothing on screen except the new tool request's tile. The new tool request's routes (`src/intake.js`: start, answer, adjust, revise, confirm, abandon) pass
  `actor(req)` instead of a bare "manager", so an admin answering on a company's board reads as admin, and the request's
  tile carries the account's name instead of "manager". A row with a human role and no `actor_account` is a shared
  password (or older than this). Rows from before stay as they were: the record is insert-only and nothing else kept
  which account made a request. Tests: `scripts/e2e/whodid.js`.
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
  confirming (`POST /api/runs/:id/confirm {requirement}`). **Off by default since 2026-10-01** (see "The first-time
  user round"): the requirement is still written and the build follows it, but there is no stop; `SOS_REQUIREMENT_GATE=on`
  brings the stop back, now with one "I've read all N" tick instead of a box per change.
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
  `ai.modelFor(role)`, `ai.judge({ task, input, answer })` (one judgment in a
  shape the module asks for, 2026-10-20, see "Steps that need judgment"), `manifest`. A module declares chat personas in
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

## 2026-09-27: five fixes from Brendan before the next phase of the audit

- **Back to the board from a tool, demo only.** Every page of a demo company's tool carries an "Improvement board" pill
  bottom left (the feedback widget, `data-demo="1"` from `registry.widgetInject`, which reads `companies.demo` with a
  15 s memo). A paid site's floor never gets it: activation sets `demo=false`. Not drawn inside a frame.
- **A refill is $30 for $10** (www `TOPUP_USD` 30, new `TOPUP_CREDIT_USD` 10; `TOPUP_RATE` defaults to credit over
  price). Still +100% a refill. Brendan: "to help our rate of recouping demo credits".
- **The deploy gate is the top of the card and of In progress.** `gateTopHtml` puts "Next step: make it live" (or put
  it on the floor), the button and the preview right under the card's title; cards at the gate sort first in the
  column. Discard stays under more. A floor login still sees only the preview link, where it was.
- **A passkey answers for the authenticator code on admin-level actions** (delete, restore, account actions, activate,
  stop activating, end a site). `POST /api/me/passkeys/step-up/options` makes a challenge for this account's own
  passkeys; the answer rides in the action's body as `{ passkey }`; `accounts.stepUp(..., req)` checks it through
  `passkeys.checkStepUp` (used once, five minutes). `auth.checkAdminCode` reads `req.body.passkey`, so no route
  changed. On /admin a code box left empty makes the button ask for the passkey; the step-up modal has "Use my passkey".
- **Low credit no longer lights /admin.** Only out of credit does, and "Seen, clear it" on the Pins tab clears it
  (`self_serve.credit_seen_usd`, the credit bought at that moment) until the company refills and runs out again.

- **Built with Railpack (2026-09-28).** Both services moved off Nixpacks, which Railway lists as deprecated, to
  Railpack, its default. railway.json says `"builder": "RAILPACK"` in both repos (railway.json overrides the service
  setting, so the file is what decides). `railpack.json` in each repo pins Node 24 (`packages.node`; Nixpacks was
  running 24.10, and `engines` alone says only ">=20"). In sos it also lists `chromium` and `fonts-liberation` under
  `deploy.aptPackages`, so the runtime image (Debian trixie slim, running as root) has Debian's real Chromium at
  `/usr/bin/chromium`; the Ubuntu apt package the Nixpacks image had was only a snap stub, which is why Chromium came
  from Nix before. `nixpacks.toml` is gone. What to read after a deploy: the build log names Railpack, the deploy log's
  `[pageload]` line says the browser starts at /usr/bin/chromium, and the `[runner]` line still says "as its own user"
  and "Node permission flags on" (the runner's per-company uid has to read Node under /mise and the app under /app).
  No "The build check has no browser" phone alert. Rollback is the previous deployment in Railway.

- **anetix.ai: the account first, and the principle only (2026-09-28, www repo).** A good pin now goes straight to
  `/start` (name the company, pick a password) instead of the page about the product, because a person who read first
  could leave and come back with no password (Brendan, after his own walkthrough). Making the demo lands on `/`,
  which shows the page about the product to the browser that made it (the seven day welcome cookie) and leads on to
  `/welcome`, the sign-in and the authenticator. `/start` checks the pin with the product on every view (where
  `home`, which `pin_refusals.where_from` already knew), since the front page no longer does. The page carries the
  principle only: the pilot's figures (the "not possible in February" section) and the floor photo are gone (the photo
  out of the repo), a "rules the loop runs on" section stands in for them (the manager gate, the checks, rollback,
  the data download in Settings), and the bio no longer names the alpha. Brendan says the results on a call, never
  on the page. The headshots stay (his call). The pin message (`selfserve.pinMessage`) already described this order,
  so the product did not change. Tests: www test-www 112, e2e 69, e2e-golive 56, e2e-golive-browser 26, e2e-activate 50.

- **The launch audit's Phase 3, first pass: the sign-in from setup, refills checked with Stripe, the quick fixes
  (2026-09-28).** Brendan's calls: build 3.8 first, then 3.6 and 3.7, the quick fixes 3.2, 3.4, 3.13, 3.14 and the
  dependency pass 3.18; the rest Later. 3.5 and 3.15 were already covered (the Terms tick box with its refund words
  and the footer contacts; 2.15's percent-only credit).
  (3.8) **A new demo is not asked for its password again.** `src/tickets.js`: when anetix.ai makes a demo for the
  person's browser (`POST /api/www/companies` with `collect`, created just now), the answer carries
  `signin_ticket` = `<id>.<token>` (32 random bytes; only the sha256 kept in `platform.signin_tickets`, with the
  account's generation and an hour, `SOS_SIGNIN_TICKET_MIN`). anetix.ai keeps it in the person's own welcome cookie;
  "Sign in to your demo" on the page about the product and "Set up your authenticator" on /welcome go through
  `/welcome/go` there, which spends it from the cookie and sends the browser to `GET /login/ticket?t=` here. That
  claims it in one statement and starts the enrollment-only session a password would, then the authenticator setup.
  It opens only a switched-on manager account with a company, at the same generation, with NO verified
  authenticator and no passkey (the only state a password alone signs in to), once. Anything else: the sign-in page
  with the email filled (`/login?account=`), a made-up ticket names no one, the answer sends no Referer and is never
  cached, and the sign-in log says `signin_ticket` or `ticket_refused` with why. Never in a backup; a restore
  clears them. www's /welcome with a good ticket leads with the button and folds the password form under "Sign in
  with your password instead".
  (3.7) **The product reads a refill in Stripe itself.** `src/stripecheck.js` with `STRIPE_READ_KEY` (a restricted
  key, Checkout Sessions: Read only): `POST /api/www/credit` adds nothing unless Stripe says the session is a paid,
  complete refill (`metadata.kind` topup) for this company, for the dollars claimed, naming the credit claimed, and
  that credit is not more than the dollars. A payment already on the ledger is "already done" first, without asking
  Stripe. Refused: 403 `unverified` and a phone alert; Stripe out of reach: 503, nothing added (the page says try
  again, Stripe resends its webhook, the reconcile asks later). Unset: as before, and the Sites tab line "Refills
  checked with Stripe" says no (and warns when the read key's mode differs from anetix.ai's Stripe).
  (3.6, www) **A missed refill is found.** anetix.ai lists the paid refills of the last `RECONCILE_DAYS` (3) days in
  Stripe every `RECONCILE_MS` (6 hours, and 5 minutes after boot) and sends each through the same fulfil the page and
  the webhook use; only one that never arrived adds credit, and each such is a phone alert.
  (3.2, www) a pin typed into Sign in as "ABCD EFGH" is caught as a pin. (3.4, www) after a refill the page leads
  with the thanks and Back to your board, the refill form folded under Refill again. (3.13) the board's DEMO strip:
  its rolling words are hidden from screen readers and one line says "A demo company on Anetix". (3.14) "Remember
  this device", on the product's sign-in and anetix.ai's. (3.18) puppeteer-core 24 to 25 (its browser download path
  pulled extract-zip's advisories; this app never downloads a browser); `engines` is Node 22.12 or newer, and
  Railway runs 24. npm audit is clean on both services.
  From Brendan's first outside feedback, in www: the hero reads "A manager tries it, approves it and the floor has it
  the same shift"; a tick box now sits beside its sentence on every page (the rule was only on the Go live screens,
  so on the set-up form and the refill page the checkbox stretched to its own line above the words); the set-up
  form names the email as the sign-in (`autocomplete="username"`), so a password manager saves the password under
  the email and fills it at the next sign-in instead of under the person's name.
  **What a refill is for (Brendan, 2026-09-28):** wherever Add credit is offered (the board's credit line and its
  out-of-credit panel here; the refill page, its thanks and the page about the product on anetix.ai) the words say a
  refill pays for the AI your builds use and keeps free demos going for other plants, and the refill page adds the
  mission: operators and managers in charge of the software they work with, and American manufacturing stronger for
  it. No dollar figure of AI cost, and not the word "empower" (Brendan's own banned list).
  Tests: run-all 43 suites, 1,607 checks (new `phase3` 27, with a fake Stripe on 4555); `scripts/test-phase3.js` 16;
  every unit suite; passkeys-browser 44; demorequests-browser 33 (its pin now lands on /start); www
  test-www 123, e2e 82 (with the product reading refills from www's fake Stripe), e2e-golive 56,
  e2e-golive-browser 26, e2e-activate 50.

- **The pin message is two short lists (2026-09-28).** Brendan: "more concise and include instructions." `selfserve.pinMessage`
  (the one message whichever way a pin is made) is now: the pin and how long it is good for; "Getting in" in three
  steps (the pin with the email, company and password, the second step); "A quick tour" in four steps with the
  board's own button names ("+ New tool" and "Approve build", "Sample data", "Feedback" as the operator, "Approve
  build", the preview, "Make it live" and "Roll back" as the manager); how to come back; who to write to. Still no
  dashes and no "we". `scripts/test-phase2.js` checks every named button is still on the board word for word, so a
  renamed button fails the test until the message follows. Tests: test-phase2 20, e2e phase2 21 (its comparison
  now matches the name as a whole word: "Sam" was also taking the "Sam" out of "Sample data"), demorequests-browser 33.


- **Changes join the preview (2026-09-28, `src/pipeline.js` joinPreview, `registry.createDraftVersion(base)`).** From
  the first PE partner who tried a demo: "Somewhat surprised that I could not update a preview build with new
  functionality. Almost seemed I had to make it go live in order to add or modify functionality." He was right: a build
  waiting at the deploy gate counted as the tool's active run, so every change approved after it queued until Make
  it live, and on a tool that had never been live a queued change would have been built from an empty copy.
  Brendan's calls: a change approved while a preview waits JOINS it by default (no new button), and Discard on a
  stacked preview takes out only the newest change. How it works: `kickQueue` (now one kick at a time per module,
  a promise chain in `KICKS`) finds the active run waiting at `await_deploy` whose `to_version` is the staged version
  and calls `joinPreview`: every queued run that has not started (no draft, no fix round, not a new tool) is merged
  into the oldest (the others `cancelled` with `evidence.merged_into`), the preview's run is claimed with one
  conditional UPDATE to status `stacked` (`evidence.stacked_under`), and the lead gets `proposal_ids` = every change
  in the preview plus its own, `from_version` = the preview's version, and `evidence.stack = { on, own, base, live,
  carried }` (`carried`: each run below with its proposal ids, title and what_changed). `ownIds(run)` is what the run
  builds itself: the requirement, its item count, `proposalsText` and the cap use it; the board, the deploy, the
  close-out and "did it fix it?" use `proposal_ids`. The draft is a copy of the preview (`createDraftVersion(company,
  mod, base)`), the build prompt says it is not the live version and lists what it already carries, the gate, the
  cross-check diff, the checks and the data wall read `from_version` (the preview), so an earlier change's migration
  and check in the preview are held like any other. `setRun` kicks the queue whenever a run lands at the gate
  (status waiting at `await_deploy`, from the pipeline or from a test campaign's step), so changes approved while the
  preview was still building go on top the moment it is ready; while the top of a stack is stopped, nothing starts
  from the live version over it (`stackedRun` blocks the queue; `startRun`, `retry` and `fix` count it as busy
  unless the run is that stack's own top). Deploy: `deployVersion(top)`, then every stacked run below is `deployed`
  with `evidence.went_live_in` and logged as step `stack` (loop health counts one deploy), each request's outcome
  keeps the words of the build that made it, a new tool's run below gets `modulebuild.afterDeploy`. `wasEverLive`
  ignores runs with `went_live_in`, so a draft underneath stays "never approved" in Versions. Rollback of any of them
  rolls back the top one and marks the rest. Cancel of the top (at the gate, failed, running or waiting on its
  requirement) is the peel: its own proposals back to review, the run below re-staged (`stageVersion`) and back to
  `waiting` at the gate, then the queue is kicked. Deploy or cancel of a stacked run is refused in words ("a change
  is being added on top of this preview; take that one out first"). Board: `liveRun()` hides stacked runs, the top
  run's card is "N changes in this preview", `live version → new version` (or "not live yet"), "added last" chips on
  the changes Discard would take out, "Discard the newest change", a blue line while it builds ("Added to the
  preview ... Open the preview"), and at the gate "In this preview:" with each build's summary. Queued cards say
  "it is added to the preview of X as soon as that preview is ready, and they go live together". The staged bar's
  "what changed?" panel lists the earlier changes in the preview (`staged-changes` answers `also`) and says a change
  asked for on the preview is built on top of it. Record kind `preview_joined`; event `preview_joined`.
  **Requests sent from a preview read the preview.** `registry.versionForPage(row, page)`: a page under `/staging/`
  is the staged version, anything else the live one, and a tool never live has only its preview. The feedback route
  resolves the screen label against it (a request from a new tool's preview showed its raw address, the #168 card),
  the proposer reads that version's files (`moduleContext` falls back to the staged version; before this a tool never
  live was proposed on with no source at all) and is told "Sent from the preview, version N, which is not live yet".
  The board's Adjust screen list falls back to the staged manifest. Tests: `scripts/e2e/chamber.js` (63): stack,
  peel, a stopped top holding the queue then a fix and a third change on top, one deploy for three, rollback from the
  bottom run, three approvals merged into one run, two approvals in the same instant claiming the preview once, and a
  new tool's first version changed from its preview and put live as v2 with its request closed.

- **Outside connections are off until Anetix turns them on, one tool at a time; integration requests (2026-09-28,
  `src/connections.js` allowances, `src/modulegate.js` connection-not-on, `src/requests.js` handoff, `src/intake.js`
  handoffs).** The same demo: the tool Chris built grew a "Refresh from Epicor" button that could only ever answer
  "Could not reach Epicor", and his "how do I connect Epicor to this?" had nowhere to go but Decline. Brendan: "it
  should deny external connections unless we have turned it on for that use case; it shouldn't build something that
  tries to connect to something that is not there", and these requests go to an integration team with a light
  handoff for now. Decided per tool, not per company. `platform.connection_allowances (company, module, kind)`: `erp`
  and `printer` are the kinds that reach outside; a `files` connection (a spreadsheet the manager loads) and a
  keyboard scanner reach nothing and are always fine. Turned on by an admin on the Companies tab (an "Outside" column
  per tool, `POST /api/admin/companies/:slug/outside { module, kind, on }`) or from the request itself (`POST
  /api/admin/requests/:id/turn-on`); a tool that does not exist yet can be turned on by its slug. Held three ways:
  (1) the builder is told (`connections.outsideBrief` in `buildPrompt` and the module build): what is on, what not to
  declare or build a screen or button for, and that a declaration the tool already had stays; (2) the module gate
  refuses a build that ADDS an `erp` or `printer` declaration not turned on (`checkOutside`, only when the caller
  passes `outside`, which the pipeline and the module build do; the registry's backstop at stage and deploy does not,
  so no preview built before this is refused at the gate), with the card's head "The build reached for an outside
  system that is not connected for this tool" and the fix round's brief naming it; a declaration the version it
  started from already had, same name and kind, is left alone; (3) a new tool's design is told what is on
  (`outsideDesignBrief`), lists the rest under `handoffs` (kind, system, would_add, until), and `splitHandoffs` moves
  anything it still put under connections; the popout says "Connected later by Anetix: Epicor (until then, ...)",
  confirm makes one integration request per system (`requests.handoffNew`), and the build prompt names them as NOT
  connected. **Integration requests:** the proposer's triage has a fifth outcome, `integration`, when a request asks
  to connect the tool to an outside system that is not on for it (the prompt says what is on); `requests.handoff`
  turns the row into a request to Anetix (`module='platform'`, `anetix_kind='integration'`, `about_module`,
  `about_system`, `about_kind`), so the board's "Requests to Anetix" strip, My requests and the Requests tab carry it
  with the integration team's own words ("Sent to Anetix's integration team, who connect outside systems like your
  ERP or a label printer. Nobody has looked yet." ... "Connected by Anetix."). The tab shows the tool, the system and
  whether the kind is on, with "Turn on ERP for this tool", and Fixed reads "Connected". The manager keeps "It is a
  change to the tool" (`POST /api/feedback/:id/to-tool`, `requests.backToTool` then a forced proposal) for a request
  the proposer misread. Phone alert "Integration request". Record kinds `connection_turned_on`/`_off`,
  `handed_to_integration`, `integration_back_to_tool`. The table is in the backup and goes with a company's delete.
  Fake mode: ADDERP / ADDERPALWAYS make a change declare an Epicor connection (the fix round takes it out, unless
  ALWAYS), a new tool whose design lists an erp connection declares one, INTEGRATION in a request makes the proposer
  hand it off. Not built: machine and scale kinds (a request for one lands with a word back only), and nothing
  removes a connection an existing tool already declares (Chris's tracker keeps its Epicor button until a change takes
  it out or the ERP is turned on and set up). Tests: `scripts/e2e/outside.js` (47), `scripts/test-modulegate.js`
  section 16 (109 in all). With both: run-all 45 suites, 1,717 checks, and every unit suite.

- **Migrations run exactly what was checked (2026-09-28, `src/migrationsql.js`, `src/migrate.js`).** A verified
  bypass: `splitStatements` cut only on a `;` at a line end and `applyMigrations` ran the RAW file on the platform's
  pool, so `CREATE TABLE x (id int); CREATE ROLE evil LOGIN SUPERUSER PASSWORD 'p';` on one line passed as one
  CREATE TABLE and made a superuser (reproduced on a real Postgres with the old code). Same-line `ALTER ROLE` and
  `SET search_path` passed too, and so did single statements `INSERT INTO x SELECT ... FROM pg_catalog.pg_authid` and
  `INSERT INTO x SELECT pg_read_file(...)`. Fixed in order: (1) `applyMigrations` runs the validator's statements one
  at a time in the transaction, each as `{ text, queryMode: "extended" }` (the extended protocol refuses a text that
  holds two commands), with `SET LOCAL standard_conforming_strings TO on`, never `m.sql`; a refused file hands back no
  statements. (2) The splitter is a small scanner: every `;` outside a string literal, a quoted name and a comment
  splits; `--` and nested `/* */` comments are removed; a `$` outside quoted text (dollar quoting, parameters) and an
  `E'...'` or `U&'...'` string (whose backslash escapes the scanner does not read) are refused outright. (3) An INSERT
  is `INSERT INTO ident (cols) VALUES (...)[, (...)]` and nothing after the last row (no SELECT, RETURNING or ON
  CONFLICT); an ALTER TABLE only adds columns (one ALTER); the forbidden words gained ROLE, USER, SET, EXECUTE, CALL,
  SELECT, PROCEDURE, LISTEN, NOTIFY, PREPARE, IMPORT (whole words outside literals, still allowed as a column being
  defined, `role TEXT`), and a list that is refused even as a name: `pg_*`, `information_schema`, and the functions
  that run a query given as text or touch server files or settings (`query_to_xml`, `table_to_xml`,
  `schema_to_xml`, `database_to_xml`, `cursor_to_xml` and their variants, `lo_*(` as a call (a column named `lo_alarm` passes, since 2026-09-29), `dblink*`, `set_config`,
  `current_setting`), because a VALUES row or a DEFAULT could call them with the SQL hidden in a string. A double
  quote is now judged outside literals only (a JSON seed like `'{"k": 1}'::jsonb` passes; it used to be refused).
  Also closed: the index self-heal (`declaredIndexes`) ran a regex over the raw file, so a `CREATE INDEX ...` written
  INSIDE a seed row's text was found and run at every boot; it now reads the validator's statements, replays a
  CREATE INDEX only when it is a statement of its own that passes, and builds UNIQUE constraints from bare names
  only. The module gate runs the validator on a build's new migration files (rule `migration-shape`, lanes only), so a
  refused statement is a finding the fix round names instead of a build that stops at staging with no fix round.
  GUARDRAILS.md, MODULE-CONTRACT.md and the build prompt say the new shape. At boot, `migrate.auditStored()` checks
  every migration file stored in any version against the rule as it is now and logs each one it would refuse with
  whether the floor tables already have it (an applied file never runs on the floor again; it would run again on a
  test floor rebuild, a copy into another company, or, when not yet applied, the tool's next deploy); event
  `migration_audit`. The boot log also names the database role the platform connects as and its powers (`[db]`).
  Tests: `scripts/test-migrate.js` (84: the five payloads and 39 ways around the splitter and the shapes refused, 16
  normal shapes and the skeleton passing, the self-heal, every migration on disk, and on a real Postgres that no
  payload runs, a normal file runs statement by statement, the protocol refuses two commands, and the audit names a
  refused stored file); `test-modulegate.js` section 17; `test-restore.js` (the self-heal's declarations now in file
  order). **Next, not built:** run migrations under a per-company migrator role (owns only that company's
  `mod_`/`stg_`/`tst_` schemas, NOSUPERUSER NOCREATEROLE NOCREATEDB, no USAGE on `platform`), entered with `SET LOCAL
  ROLE` inside the migration transaction, so a validator miss cannot reach past the company.

- **Every company is the same, and a boot brings it up to date (2026-09-29).** Brendan: "some of the older companies
  are not updated to the new designs like sample data. They should all be the same and when a system wide update goes
  it standardizes everything." They were not: sample data, the "Make it live" wording, the "Try the preview with
  sample data" link, the link back to the board on a tool's pages and diagrams drawn on request all read
  `companies.demo`, a column set once when a company is made, and only companies made on anetix.ai after the demo
  workflow (2026-09-25) carry it. A company added by hand on /admin (the Demo Company among them) and the few made on
  anetix.ai before that never got any of them. Now `src/kind.js` decides, at the moment it matters: a PAID SITE
  (`platform.sites.stage = 'subscribed'`) or not. A paid site has a real floor, so no made-up rows go into its
  tables, its tool pages keep the floor's own view and diagrams are drawn at deploy as before; every other company is
  a trial and gets every trial feature, however and whenever it was made (`kind.isTrial`, memoized 15 s per company,
  forgotten on activation, back-to-demo and delete). `companies.demo` keeps its narrower job: a company that came in
  from anetix.ai with credit and one manager account (the credit line, Go live, the DEMO strip, Settings without the
  floor's cards, the refund of a stopped build). The board, settings and diagrams answers carry `trial` beside `demo`.
  At every boot, after every module's own init, `kind.standardize()` brings the companies that already exist to the
  rule: an anetix.ai company (a `self_serve` row) that is neither a paid site nor being switched on is marked a demo
  (the early ones were made before the flag existed), and a company still on the shared passwords is named in the
  boot log until an admin gives it its own (passwords are shown once, so a boot cannot make them up); event
  `companies_standardized`. Idempotent: a second boot finds nothing. Tests: `scripts/e2e/standardize.js` (18: the
  Demo Company has sample data, the board link and diagrams on request; a paid site has none of them; a boot marks
  an early demo and an early order, leaves one being switched on and a paid site alone, names a company with no
  sign-in, and a second run changes nothing); `scripts/e2e/sample.js` now proves a paid site has no sample data (it
  proved the Demo Company had none). The rule for what comes next is in CLAUDE.md's hard rules.

- **The first-time user round (2026-10-01).** Two LGO classmates tried a demo for the first time and Brendan brought
  back their notes, broken into eight changes with him. In the order they were asked for:
  1. *The requirements screen says what it is.* The end of "+ New tool" was "The design" with a box per point. It is
     now "Confirm the requirements": a short line on what to do (read each point, say what is wrong under it, then
     confirm), the points numbered, each with a tag for what it is about (How it moves, Who uses it, A screen, A rule,
     A number it shows, What it works with, Starting data, Left for later), and "N points to read" in the head. The
     design schema asks the model for each point's `kind` (`intake.POINT_KINDS`); every point carries an id (`p1`...,
     `intake.withIds`, applied on read so designs from before have them). The board's card reads "Requirements ready
     to confirm: N points to read" and its button "Confirm the requirements".
  2. *Changes go through the agent, not the text* (Adal; Morgan doubled down). "Adjust the text", the raw editor of the
     whole reference that did not match the points on screen, is gone from the screen (`POST /api/intakes/:id/adjust`
     still answers). Under each point "Change this" takes a sentence ("What should be different?"); "+ Add something
     missing" takes one more; they collect on the screen (kept in the browser per request until sent, so a locked
     phone loses nothing) and "Send N changes to the agent" sends them in ONE pass: `POST /api/intakes/:id/revise
     {changes: [{point: "p2" | null, text}]}` (at most 12, blank ones dropped, an unknown point read as an addition).
     Brendan's rule: it must not reset the other requirements. The model gets the current points with their ids and
     the changes, and answers each point with its old id and whether it changed (`REVISE_SCHEMA`); then
     `intake.mergeRevision` keeps every point nobody named WORD FOR WORD (an unasked rewording is undone, a dropped
     point put back where it was), lets a named point go only when it was named, gives additions new ids, and marks
     what is different: "Changed as you asked", "Changed to fit" (the model said a requested change needed it), "New".
     A point named for removal is listed under "Taken out as you asked". The revision is kept on the design
     (`design.revisions`) and on the record (`intake_revised`: the points before and after, the changes). While it
     works the screen says every other point stays as it was. On a failure the design on screen is put back.
  3. *One tick, after the end.* "Lets go confirm all until it starts to become a problem", with the middle option:
     instead of a box per point, one "I've read all N points" tick shows once the end of the list has been on screen
     (at once when the list fits), and only it opens Approve build. A new version (after changes) is read again: the
     tick starts unticked. With changes waiting, Approve is replaced by "Send N changes".
     **The board's requirement gate, reassessed** (Brendan: "nothing really changed since the requirements were just
     confirmed"): a functionality change no longer stops after its requirement is written. The approval a moment
     before is the confirmation; the requirement is still written (it guides the builder and the cross-check, and
     its "how we will know it works" becomes the change's check) and the card shows it under "What the build follows".
     The step reads "Writing down what it should do". `SOS_REQUIREMENT_GATE=on` restores the stop (`pipeline.
     requirementGate`), with the one-tick treatment; the board's answer carries `requirement_gate`. The record marks
     such a requirement `gate: false`.
  4. *The fixed questions explain themselves* (the agent's rounds left as they are, "we will see if we need to expand
     that"). Each fixed question has a `why` (`src/intake-questions.js`): one short line on what the answer is used
     for, beside a "Needed" or "Optional" chip above the question. A dot per question under the head (green answered,
     a red ring for a needed one left behind, a ring on the current one; tap to go there), and the head counts what is
     still needed ("4 of 13 answered · 9 needed").
  5. *Review all with AI*, for the tools the filter shows, skipping cards still under review: one panel at the top of
     the Feedback column ("Review all N with AI") when two or more requests wait on the manager's button. `POST
     /api/c/:slug/feedback/review-all {ids}` checks each again (this company's, a tool's request, still new, not folded,
     not being read, no question out, no flag), marks the ones that pass as being read at once (their cards say so) and
     drafts them in the background two at a time with the same call as the card's own button; a failure marks the card
     as the arrival reader does. Out of credit: 402 and nothing marked. Event and record `review_all`. Under
     `/api/c/:slug/feedback/`, which a module page's policy does not open.
  6. *Sample data shows the wait.* Pressing Fill draws a turning wheel and "Starting the agent..." before the round trip
     and locks the button; then "Writing sample data...", a bar that fills over the usual minute and then keeps moving,
     and the seconds so far, refreshed every 2 s.
  7. *Running out of credit no longer looks like being signed out.* What happened (Railway logs, 2026-09-30 16:41 UTC):
     the demo's sample data fill was refused for credit (a 500, as it happened), the manager went to the refill page,
     12 s later left it for anetix.ai's front page (the ANETIX mark, or a second Back), met the welcome page's sign-in
     and signed in again. The product session was alive the whole time; anetix.ai cannot see it, so it showed a
     sign-in. Now: a credit refusal is 402 with `code: credit_out` and the refill page named, never a 500
     (`selfserve.assertCredit`; the intake, Review with AI and sample routes pass the 402 on). The board's refill links
     and its credit question carry `?back=` (the board's own address, plus `?intake=<id>` when a new-tool popout is
     open, `refillUrl`). On anetix.ai (www repo) the refill page leads with "&larr; Back to your board. You are still
     signed in there. Nothing you built or answered is lost.", its ANETIX mark goes there too, and the spot rides
     through Stripe (success and cancel) to the thanks ("Back to your board"); `backPath` takes only a path under that
     company's board (no host, no `//`, no backslash, no spaces, 300 characters). And the front door asks: `GET
     /login/session` (before the sign-in middleware, the same CORS as `/login`: only anetix.ai can read it; same site,
     so the cookie rides along) answers `{signed_in, board, name}` from `auth.currentSession` (the middleware's checks
     as data, no redirect). The wall, the welcome page and the page about the product ask it; signed in, a box says
     "You are still signed in to <company>. Nothing was lost." with Go to your board, the header's sign-in link
     becomes Go to your board and the page's sign-in lines hide (`.still-in .signin-only`). The admin's preview does
     not ask.
  8. *Every screen at once* (first cut; Brendan expects to experiment with the layout). "Screens" on a tool with two or
     more screens (and a lone tool's name) opens a popout of small live copies of every screen side by side, live or
     the waiting preview (a Live / Preview switch when both), each labeled with its name and address; tapping one goes
     to that screen. A waiting build's card has "See every screen of the preview". The copies are the real pages in
     frames (module pages allow framing by the board: `frame-ancestors 'self'`), drawn at their size (1280 wide, or 400
     for a screen whose label says phone, operator, station, tablet or floor) and shrunk to the tile; not clickable
     themselves. The board's answer carries `pages[module] = {live, staged}` with the address of each screen, a route's
     parameter filled from the tool's checks as the page check does (`pageload.screenPaths`).
  Tests: `scripts/e2e/firstrun.js` (46: the points, a revision that keeps the rest word for word, the merge on its own,
  the gate off, Review all and what it skips, 402 for a new tool, sample data, Review with AI and Review all, `/login/
  session` for anetix.ai only, the screens on the board's answer); `scripts/e2e/firstrun-browser.js` (31: the dots and
  chips, the requirements screen end to end on a desk and a phone, the wheel before the round trip, Review all, the
  Screens popout and the tap); www `test-www.js` (+8) and `e2e.js` (+11: the way back, a bad back dropped, the spot
  through Stripe). Every other suite runs with the gate off as it ships, except requests, models and chamber, which walk the gate
  and turn it on in run-all.sh.

- **Connector sign-in and the admin MCP (2026-10-05).** Brendan: "adding MCP functionality, so each company can have
  an MCP to their own data and processes then I can also have an admin MCP." Customers asked for it, for Claude. The
  design and his decisions are `docs/MCP.md`; this is its phase 1: the sign-in both MCPs share, and the admin one.
  The company MCP is phase 2 and is not built.
  - *The address.* `POST https://app.anetix.ai/mcp/admin` (`src/mcp.js`): Streamable HTTP, stateless, a JSON answer
    per call, so a redeploy costs a connected app nothing. GET and DELETE are a 405. It is mounted after `edge.gate`
    and BEFORE `auth.middleware`: an app carries a bearer token, a cookie is never read there and none is set, and the
    internal token does not open it.
  - *Off until `SOS_PUBLIC_URL` is set* to the instance's own address (https, no path; http only for this computer).
    Unset, every connector path (`/mcp*`, `/oauth/*`, `/.well-known/oauth-*`) is a 404 and the Accounts tab says
    Off. The issuer is that variable, never a request's Host header.
  - *Sign-in is OAuth 2.1 on the named accounts* (`src/mcpauth.js` is the provider behind the MCP SDK's own
    handlers, mounted one by one under `/oauth/` because the SDK's ready-made router puts them at the site's root).
    The app gets a 401 pointing at `/.well-known/oauth-protected-resource/mcp/admin`, registers itself
    (`/oauth/register`), and sends the browser to `/oauth/authorize`, which checks the app and its redirect address
    and hands the browser to the consent page (`/oauth/consent`, `public/connect.html`) with the request sealed in
    the address (an HMAC under the session secret, 15 minutes). Not signed in: the page goes to the account sign-in
    and back. The page names the app, the address, who is signed in, where the answer goes (with a warning when
    that is a program on this computer), what the app can do, and how long it lasts. **Allow takes a fresh passkey
    or code** (`accounts.stepUp`, password under break glass): the session alone never connects an app, and an
    answer posted from another origin is refused. Then a one-time code (2 minutes, only its hash kept) goes back to
    the app, which trades it with its PKCE proof at `/oauth/token`.
  - *Who can.* A named ADMIN account, switched on, with its second factor, and only for the admin address. A floor
    session, a shared company password, the shared admin password and a manager account cannot (`mcpauth.refusal`;
    a manager is told the company side is not open yet).
  - *Tokens.* Random, only sha256 kept (`platform.mcp_tokens`). Access 60 minutes (`SOS_MCP_ACCESS_MIN`). Refresh
    tokens are one use each and rotate; a connection (`platform.mcp_grants`) lives by the admin cookie's own
    windows: 7 days idle, 30 days whatever its use (`auth.WINDOWS.admin`), so Brendan allows his app again about
    once a month. A refresh token used a second time after 60 seconds ends the connection (inside 60 seconds it is
    only refused: an app whose first try was cut off tries once more). A code used twice ends the connection it
    made. Every call re-checks the account: switched off, removed, or Sign out everywhere (the generation) ends its
    apps. A token made for another address of the instance is a 401 here.
  - *Where an answer may go* is an allow-list (`SOS_MCP_REDIRECTS`): by default exactly
    `https://claude.ai/api/mcp/auth_callback` (Claude on the web, Desktop, mobile and Cowork, from Anthropic's docs)
    and `loopback` (http on localhost or 127.0.0.1, any port: Claude Code). An app is registered only for
    the addresses on the list: any other it names is left out, an app with none left is refused, and what was
    left out is logged, which is how the list grows on purpose.
  - *The nine tools* (`src/mcp-admin.js`), each a wrapper over what a tab of /admin reads: `list_companies`,
    `list_demos`, `get_demo`, `list_sites`, `loop_health`, `ai_spend`, `list_requests_to_anetix`,
    `list_stopped_builds`, `list_runs`. All read only. **What never leaves:** a row from a company's tool, an
    upload, a photo, a diff, a tool's code; an access pin, a Stripe id, a card, a billing contact, a street
    address; and the WORDS of a failed check or a stopped build (a failed check can quote the record it choked
    on), which leave as the kind of stop only (`health.stopKind`: gate, reviewer, tests, campaign, ai, other). A
    demo's chat persona lines stay out of `get_demo` for the same reason. What does leave: words people typed to
    Anetix or into the loop during a demo, as the Demos and Requests tabs show them; a site that went live without
    the learning opt-in stops at that day, by the rule `src/demos.js` already keeps.
  - *The call log.* `platform.mcp_calls`: who, which app, which tool, what was asked (clipped), whether it worked,
    how long, how many characters went back; never the answer. Kept `SOS_MCP_CALL_DAYS` (400). Connecting, a no,
    a disconnect and a token used twice are on the sign-in log (`mcp_consent_yes`, `mcp_consent_no`,
    `mcp_connected`, `mcp_disconnected`, `mcp_code_reuse`, `mcp_refresh_reuse`).
  - *The Accounts tab* has Connected apps: the address to give the app, each connection (app, whose, connected, last
    used, calls, ends) with Disconnect (asks for nothing, like removing a trusted computer), and the last 40 calls
    (`GET /api/admin/mcp`, `POST /api/admin/mcp/grants/:id/disconnect`).
  - *Backup.* None of the five tables is ever in a backup file; a restore clears connections, tokens and codes with
    the accounts they point at (`backup.js`), so every app is connected again after one.
  - *Found while building:* the SDK (1.30.0 in the lock; 1.32.1 has the same server side) does dynamic registration
    and does not fetch client ID documents, and Claude falls back to dynamic registration when the server does not
    advertise them, so the first build uses that. Claude registers a new client on every fresh connection, so a
    daily sweep drops the ones with no live connection. The SDK's handlers throttle by address themselves; they are
    given `edge.clientIp` and room for a sender that is many people (every hosted Claude app's calls come from
    Anthropic's range, 160.79.104.0/21).
  - *Known limits.* Not tried against the real Claude yet: the first connection on the live instance is the test,
    and Cloudflare's bot rules may need a skip for `/mcp`, `/oauth/*` and `/.well-known/*` (calls come from
    Anthropic's cloud, not a browser). ChatGPT and Copilot are not on the redirect list and were not read from a
    first-party page. Why a build stopped is a kind, not the words. No record tool for a paying site. Passkey
    step-up on the consent page is the same call /admin uses but has no browser test (the suites have no
    authenticator device).
  - *Tests:* `scripts/test-mcp.js` (34: the switch, the redirect list, the sealed request, who may connect, what
    leaves each tool, the backup rules); `scripts/e2e/mcp.js` (91: discovery, registration, the consent page's two
    calls for every kind of session, the trade and its wrong turns, all nine tools with a canary row and a canary
    failure line that no answer may carry, the MCP SDK's own OAuth client connecting from the address alone and
    refreshing by itself, the call log, refresh rotation, and everything that ends a connection) and its `off` mode
    (2: every path a 404 without the variable); `scripts/e2e/mcp-browser.js` (27: the consent page signed out and
    in, a wrong code, Allow, Cancel, the this-computer warning, a changed request, a phone, the Accounts tab and
    Disconnect, a manager account). All 51 suites of `run-all.sh` and every unit suite pass with it.

- **Price book 2 (by the tool live on the floor), the pilot offer, and the board link on every page** (2026-10-05;
  `src/sites.js` BOOK_V2, `src/modprice.js`, `src/pilot.js`; www `internal.js`). Brendan: "a total overhaul of the
  payment plan ... $300 per month per module ... it stacks on until they reach the maxed out price they would normally
  have with the current plan. So it makes entry much easier and it would also cap out their price for maximum
  expansion within their plant. This is very heavily under iteration." And: "some method to sign Chelsea Clock onto
  their paid pilot plan tomorrow ... from within their board ... $1,000 then another $1,000 at the start of the
  second month." And: "every preview page needs to link back to the improvement board and every page needs to link
  back to the improvement board otherwise."
  - *Price book 2.* `per_tool_usd` 300, `min_tools` 1, and the same five bands, whose `monthly_usd` is now the CAP.
    `sites.feeFor(plan, liveTools)` is the one place the fee is worked out: 300 times the tools live (rows of
    `platform.modules` with a `live_version`), never under one tool, never over the cap. Brendan's choice of unit: a
    tool counts once it is live on the floor; drafts and previews are free. Version 1 stays in `platform.price_books`
    and an order signed under it keeps its flat price (`feeFor` answers `flat`). A new plan is version 3.
  - *The order form* (`sites.orderText`) has three shapes: by the tool (the cap, $300 a tool, today's figure, "a tool
    made live raises the fee from the next bill", the lock on both prices, and a line that the order form controls
    where the Terms' section 5 says a band price), the pilot's own, and version 1's unchanged. The figure a signer
    reads is today's count, so a tool going live between the page and the signature is a changed hash: look again.
    The Terms (5.1, 5.5) still describe band pricing; the order form controls (1.5), and the Terms want a new version
    with counsel.
  - *Activate* charges the tools live THAT day (`activate.amountFor`), frozen per card on `orders.stripe.amount` like
    the credit, on a Price per amount (`anetix_tools_v2_<cents>`). `sites.price_usd` is what the site is on.
  - *The bill follows the tools* (`src/modprice.js`): when a tool is first made live (`registry.deployVersion`, a
    library import), on every Stripe event for the site, and every 15 minutes, the fee is worked out again from the
    plan the site signed; if it moved, anetix.ai's `/internal/reprice` moves the subscription's one item to the Price
    for the new amount with `proration_behavior=none`, so the next bill is the first at it. The manager gets a notice
    (the count, the amount, the date, "nothing is charged before then"), the phone an alert, the record a line. The
    sweep asks anetix.ai even when nothing moved here, so Stripe itself is reconciled (a timed-out request that lands
    late cannot leave it on another amount). The fair-use line is 80% of what the site is on: $240 at one tool.
  - *A pilot offer* (`src/pilot.js`, `platform.sites.offer`): from a site's form on the Sites tab, a fee a month, a
    number of months, and lines of its own ("Label: words"; the order form's own labels are refused). While it stands
    the company's manager sees Review your pilot on the board (no price or end date on the board line, 2026-10-08) and in Settings even with Go live off (`golive.forBoard`,
    `resolve`, `invited`), the price screen and the order form are the pilot's ("not a software license or
    subscription fee", "ends on its own", any continuing arrangement a separate conversation), and the signed order
    keeps the offer as a band of its own (`key: "pilot"`). Changing or withdrawing it re-quotes an open draft and is
    refused once an order is signed.
  - *A pilot ends on its own.* anetix.ai makes the subscription WITH Stripe's `cancel_at` (its start plus the months,
    then set to the second on the subscription's own anchor), so no charge is made after the last payment. Activate
    refuses a pilot unless anetix.ai's ping says it can (`can: ["pilot"]`), and anetix.ai refuses a pilot with no
    months. The end date is the site's `cancel_at` and `band.pilot.ends_at` from the start and is not a cancellation
    (`billing.isPlannedEnd`): no "site cancelled" alert, a late last payment is retried instead of ending it, the
    board says nothing until the last two weeks. If the date is cleared at Stripe (Renew in the portal) the product
    puts it back through `/internal/pilot-end` (anetix.ai works the date out itself), at the event (a failure answers
    503 so Stripe sends it again) and at every sweep; a pilot still running an hour past its date is ended. A week
    before the end the phone is told. At the end the site goes back to a demo ("the pilot reached its end date").
  - *The board link.* The feedback widget draws "Improvement board" on every tool page of every company (it was a
    trial's only), and the preview's amber bar and the test floor's bar carry "back to the improvement board".
  - *Known limits.* Nothing here has run against the real Stripe: the fake has no invoices, proration or clock. Before
    relying on it, one pilot in Stripe test mode with a test clock (two paid invoices, then canceled, no third). No
    way yet to take a tool off the floor, so a fee only goes up (the order form says it can go down; the sweep would
    follow). The Terms' text is version 1's pricing. The Sites tab's quick quote does not ask how many tools.
  - *Tests:* `scripts/test-pricing.js` (66), `scripts/e2e/pricing.js` (74, a stub for anetix.ai and ntfy; in
    `run-all.sh`), the Sites tab's offer form in `sites-browser.js`, the board link in `board-browser.js` and
    `campaign-browser.js`; www `test-www.js` (141) and `e2e-activate.js` (74: a pilot and a second tool through both
    services and the fake Stripe).

- **Adding a manager to a company that already exists; a company added by hand on the Sites tab** (2026-10-06;
  `src/managers.js`, `public/join.html`, `src/sites.js`). Brendan: "We are also going to largely manage the
  improvement board and modules for him (at least at first) so I will need a company set up, where I am running it,
  then I can add him as a manager later down the road." Until now a manager account was made only with its company,
  from a pin.
  - *The invitation.* Settings has a Managers card: the accounts, and Add a manager (a name and an email). The product
    makes the manager account with a password nobody is shown and a one-time link, `/join?t=<id>.<token>`, good for 7
    days. Nothing is emailed; the link is copied and sent, like a pin. The person picks their own password on
    `/join` and lands in the enrollment-only session a new demo's manager gets, on `/c/<slug>/enroll`.
  - *The link* is the password step, once: 32 random bytes, only the sha256 kept, claimed in the statement that
    checks it, and only for an account with no second factor that is still switched on. A new link for the same person
    ends the old one. `/join` and `POST /join/look|/join` are mounted before the sign-in middleware and read no
    cookie; a wrong link counts against the address like a wrong password. The page takes the token out of the
    address bar and sends no referrer.
  - *Who may add.* An Anetix admin, any company, any time. A manager: with an account of their own (never the shared
    manager password), and once the company is a paying site (`kind.isSite`; a demo is one person's account). Never
    the floor, never another company's manager. Twelve managers a company at most.
  - *Take back* removes an invitation nobody used (and its account). *Switch off* signs a manager out for good; not
    yourself, and a manager cannot switch off the last one.
  - *A company added by hand* is not in the pipeline until it has a site row: its card on the Companies tab has "Set
    up billing (Sites tab)" (`POST /api/admin/sites/:slug/track`) and "Add a manager". From there a pilot is offered
    as for any company. An admin's own link on its board is a preview; the customer's order is started from the
    company's manager sign-in (the shared password or a named manager), and "Someone else approves this" gives the
    owner a link to sign with no account. Activate gives the floor a new password, which signs the shared-password
    sessions out; signing in again as the manager shows it once.
  - *Backup.* `manager_invites` is never in a file and is cleared by a restore, like sign-in tickets.
  - *Known limits.* No fresh second factor is asked before adding a manager. There is one manager tier: an owner tier
    (billing, signing, people) above managers is the next step, and so is a way for Anetix to run a company without
    using its shared manager password to start an order.
  - *Tests:* `scripts/test-managers.js` (9), `scripts/e2e/managers.js` (40), `scripts/e2e/managers-browser.js` (14),
    and the by-hand company's pilot through to Activate in `scripts/e2e/pricing.js` (82).
- **The admin MCP writes new tool requests** (2026-10-06; `src/mcp-intake.js`, `docs/MCP.md` "Write tools").
  Brendan: "add much more write capability to the MCP so that we can write in a tooling request automatically from a
  call transcript or tour transcript ... instead of going to handjam it all." After a call or a plant walk the answers
  to the new-tool questions are in a chat; the connected app now writes them in.
  - *Six tools on `/mcp/admin`.* Two read: `list_tool_requests`, `get_tool_request` (every question with what it takes
    and its choices, the answers, what is missing, the agent's follow-up round, the design, what to do next). Four
    write: `start_tool_request` (as Anetix, for any company), `answer_tool_request` (any number of answers in one
    call), `send_tool_request` (the open round to the agent), `change_tool_request_design` (changes to named points or
    additions, through the agent). They call `src/intake.js`, the same functions the board's routes call, so one
    unfinished request at a time, the name being free, credit and fair use all hold as they do for a person.
  - *What it cannot do.* Confirm a design, build, make anything live, withdraw a request, add a file, or change
    anything that is not a new tool request. The manager confirms on the board with their PIN, as before.
  - *A connection writes only when the person ticked it.* The consent page has a tick, off by default, "Let it start
    and fill in new tool requests" (`mcp_codes.writes` -> `mcp_grants.writes`, never changed afterwards). A connection
    without it, every one made before this change included, is told to connect again and changes nothing
    (`src/mcp.js`, logged as "read-only connection"). The Accounts tab says which each is.
  - *Whose request it is.* An app writes only to a request Anetix started through a connector
    (`module_intakes.via = 'anetix'`). A manager's own unfinished request is read for a trial and taken over only with
    `use_open` (on the record as `intake_taken_over`). A paying site that did not opt in to learning keeps its own
    request to itself: status only, never taken over.
  - *Answers are checked.* The board's page is trusted to send the right shape; an app is not. `normalize` brings each
    answer to its question's shape (option and group ids or the words on them, lengths, counts) or refuses it with
    what the question takes. One refused answer does not lose the others.
  - *On the board.* The tile says "started by Anetix", and while it is being answered: "Anetix wrote these answers
    from a conversation with you. Read them over and fix anything that is off before you send them."
  - *On the record.* Every answer, send and design change carries the account's name: "Brendan Finn (Anetix, through
    Claude)", role admin. New kinds: `intake_sent`, `intake_taken_over`.
  - *The pace.* Sends and design changes spend AI: `SOS_MCP_AI_STARTS_PER_HOUR` (30) per account, counted from
    `platform.mcp_calls`. 0 = no limit.
  - *Known limits.* No files through the connector (a photo of the whiteboard and the starting spreadsheet are added
    on the board). The transcript itself is not stored: the app distills it into the answers. No tool makes a company.
    A request Anetix sends for a walled-off company is read by the agent like any typed answer.
  - *Tests:* `scripts/test-mcp.js` (58), `scripts/e2e/mcp.js` (135), `scripts/e2e/mcp-browser.js` (31).

- **Safeguards for a company that keeps contract information here, and the upload scanner** (2026-10-08;
  `src/safeguards.js`, `src/scan.js`, `docs/SAFEGUARDS.md`, `docs/UPDATES.md`, `.github/dependabot.yml`; in the www
  repo `edge.js`). Brendan: "offering to some of the defense base", then, after the CMMC Level 1 gap audit of the
  same day (project doc `claude/cmmc-level-1-gap-audit-2026-10-08.md`): "get going on the product side fixes that
  are needed including scanning uploaded files for malware". The audit's product items P1 to P4 and P8, plus P3's
  update. `docs/SAFEGUARDS.md` is the runbook for a defense supplier, the list of where a company's information can
  go, and the draft of who covers which of the fifteen safeguards.
  - *The upload scanner (P1).* Every file from outside is scanned for malware before it is kept: a photo with a
    request (`feedback.js`), an attachment to a new tool's questions (`attachments.add`), a spreadsheet for a tool
    (`connections.previewUpload`), a company's icon from its site (`brand.readIcon`). All four go through
    `scan.check({ company, bytes, what, filename, ids })`, which speaks clamd's INSTREAM protocol over one TCP
    connection a file to a ClamAV service on the private network (`SOS_SCAN_HOST`; no dependency). Clean: kept,
    with `scan='clean'`, `scanned_at` and `scan_sig` (the signature set, "27784 of 2026-10-07") on its
    `platform.attachments` row. Flagged: refused (422), never stored, `file_refused_by_scan` on the company's
    record, `scan_refused` in the events, a phone alert with the company and the kind of file (never the file's
    name). Could not be scanned: refused (503, "try again in a few minutes") for a company with `require_scan`,
    kept as `unscanned` for any other. A photo that is refused never stops the request's words. Nothing a person
    reads names the scanner.
  - *The look-behind.* `scan.sweep()`, 90 seconds after boot and every `SOS_SCAN_SWEEP_MIN` (60): every file not
    marked clean, then every file whose last scan is older than `SOS_SCAN_RESCAN_DAYS` (7), 200 a round. A stored
    file a later scan flags is DELETED (`file_removed_by_scan`, `scan_removed`, a phone alert): a false alarm costs
    a photo or a sheet the manager sends again, a kept file would be served back to a browser. A spreadsheet's bytes
    are not kept after it is read and an icon lives in the brand, so the look-behind is over `platform.attachments`.
    Alerts, each at most once per gap: the scanner not answering (6 hours), signatures older than
    `SOS_SCAN_STALE_DAYS` (3) (a day).
  - *On /admin.* The Instance tab's Upload scanner card (`GET /api/admin/scan`, `POST /api/admin/scan/sweep`):
    answering or not and since when, the engine, the day of its signatures, stored files clean and not scanned yet,
    the last look-behind, the last file flagged; a header pill when there is no scanner, it is not answering or its
    signatures are old. With `SOS_SCAN_HOST` unset nothing changes for any company except one with `require_scan`.
  - *The switches (P2, P4)*, on the company's card under More, Safeguards (`GET` and `POST
    /api/admin/companies/:slug/safeguards`, admin only, each change a `safeguards_changed` row on the record):
    `companies.allow_talk` (the mic), `companies.allow_label_preview`, `companies.require_scan`, and
    `company_access.networks` (a `TEXT[]` of addresses and ranges). `safeguards.get(company)` is the one read,
    remembered ten seconds; a change moves a counter so a read that began before it is never remembered after it.
  - *The mic.* `/api/c/:slug/who` answers `talk`; `public/assets/dictate.js` asks it once per page and nothing
    listens before the answer (no answer counts as off, a button already drawn is taken away). Every `GET` under
    `/c/<slug>/` carries `Permissions-Policy: microphone=()` with it off and `microphone=(self)` with it on: on,
    too, because a browser that already holds the page revalidates it, and a header missing from "not changed"
    leaves the old one standing (the browser suite found a company switched back on with no microphone).
  - *Label previews.* `connections.previewPng(zpl, settings, company)` answers null with the switch off and nothing
    is sent to the public renderer; a tool falls back to the label's text as it does when the renderer is down.
  - *The plant's network.* `safeguards.networkGate`, after `auth.companyGuard`: a SHARED-password session (floor, or
    a shared manager password) from an address not on the company's list is refused on every request, 403 with a
    page that says to join the plant's wifi ("You are still signed in") or JSON `{ off_network: true }`. It is not
    signed out: back on the wifi it works. A named account (`req.sosAccount`), an admin, the internal token and
    the platform's own calls over loopback with no forwarded address (the checks and page load of a staged build)
    pass. At sign-in (`auth.loginHandler`) the refusal comes whether the password was right or wrong, with the
    same words, so it says nothing about the password; it counts against the address like a wrong password and is
    in the sign-in log (`off_network`). The address is `edge.clientIp`. Entries: an address or a range, IPv4 no
    wider than /8, IPv6 no wider than /16, twenty at most; "the network I am on" is the IPv4 address or the IPv6
    /64. The list lives on the company's access row and travels in a backup.
  - *No shared manager password.* `POST /api/admin/companies/:slug/safeguards/drop-manager-password`
    (`auth.dropManagerPassword`): refused for a company still on the old shared passwords and until a manager
    account with a second factor exists; then the manager hash goes, the generation moves (every shared session
    signs in once more, the floor's password is unchanged), `manager_password_dropped` on the record. The Sign-in
    section of the card now says when a shared manager password sits beside manager accounts, with Take it away.
  - *Updates (P3).* `@modelcontextprotocol/sdk` 1.30.0 to 1.32.1 (GHSA-6qxp-vccf-f47h, high, in its OAuth client;
    the product runs the server side); `npm audit` is 0 in both repos. `.github/dependabot.yml` in both repos
    (weekly, minor and patch grouped). `docs/UPDATES.md`: the rule (a stated time to fix, proposed, Brendan to
    confirm), the monthly check, the log.
  - *anetix.ai's edge check (P8, www repo).* `www/edge.js`, first in line in `www/server.js`: with
    `SOS_EDGE_SECRET` set on the anetix-www service a request without the Cloudflare rule's `X-SOS-Edge` header is
    refused (403), apart from `/health` and loopback; `SOS_EDGE_MODE=report` logs and refuses nothing. Until this,
    a request sent straight to Railway with `Host: anetix.ai` chose its own address for the pin limiter.
  - *A second pair of eyes (a review of the finished change, the same day), and what it changed.* A company's
    name sat inside a quoted `onclick` argument on the card with only `esc()` on it, so an apostrophe ended the
    argument: "O'Brien Tool" broke its own buttons, and a name written for the purpose would have run as script in
    an admin's session. The new button had copied the pattern from Set passwords and Delete company, and the
    account buttons did the same with a sign-in email; all of them now go through `jss()` in `admin.html`. The
    look-behind stopped at the first file the scanner gave up on and never got past it: such a file is now marked
    as tried, with why, and tried again a day later, and only a scanner that stops answering ends a round. The
    network refusal at sign-in came after the password was hashed, so its timing still told a right manager
    password from a wrong one: it now comes first. A list is only as good as the address, which is proven only
    while the edge check is enforced: a hosted instance refuses a list otherwise, the list's box says so, and boot
    says so if one is standing. `Permissions-Policy` joined the headers a tool's code cannot set. A scanner's
    "past my limits" answer is never read as a flag. `safeguards.set` saves nothing when the list is refused, and
    taking a manager password away from a company that does not exist is a 404.
  - *Decisions made in the build (Brendan to overrule).* A stored file a later scan flags is removed, not
    quarantined. The network list holds shared passwords only, never a named account. The list is checked on every
    request rather than at sign-in alone. Setting it is Anetix's, not the manager's.
  - *Known limits.* The floor's password is still one per plant and a floor device can file with no name. The
    network list is not a second factor (a guest on the plant's wifi shares its address) and a plant whose address
    changes is locked out until Anetix changes the list. The scanner takes commands from any service on the
    private network. A restore's file is not scanned at the door (the look-behind scans what it carried). A tool's
    own table may hold bytes that came through the tool's own screen, outside the scan (none does today). A wrong
    try from off the plant's network counts against that address for every sign-in. The
    header that takes the microphone away is read by Chrome and Edge; Safari may not read it. Found on the way and
    NOT changed: the data wall's ten second memory (`datawall.isWalled`) has the same stale-read race the switches
    had, so a read that began in the instant a company was walled off can be remembered as "not walled" for up to
    ten seconds.
  - *Against a real scanner.* In the sandbox, `clamd` 1.5.4 from Ubuntu's package with a hand-made signature set
    (the published md5 of the industry's test file, and a body mark): `scan.scanBuffer` got clean, flagged by hash,
    flagged by body, an empty file, three chunks, 15 MB in 0.2 s, "size limit exceeded" at 26 MB against its 25M,
    and twelve at once; then the product itself pointed at it refused the test file as an attachment and a marked
    sheet, kept a clean photo and a clean sheet, and wrote both refusals on the record. Not yet seen: the official
    image on Railway with the full signature set (the first deploy's log and the Instance tab's card are the check).
  - *Tests:* `scripts/test-scan.js` (22: the verdict and version lines, a scanner that names no signature set, the
    protocol against a stand-in scanner, a file of several chunks, a file over the limit, a scanner that hangs up or
    is not there),
    `scripts/test-safeguards.js` (19: the network list), `scripts/e2e/safeguards.js` (73, and 6 in `noscanner`
    mode), `scripts/e2e/safeguards-browser.js` (21). `scripts/e2e/fake-clamd.js` is the stand-in scanner. Three
    safeguards were broken on purpose to see the suite fail (the gate taken out, the attachment's scan skipped,
    the sign-in refusal only for a right password): six checks failed. www `scripts/test-www.js` has the edge
    check's five cases (146 in all; www e2e 93, e2e-golive 56, e2e-golive-browser 26, e2e-activate 74). `run-all.sh`:
    57 suites, 2,173 checks, and the 42 unit suites. An older suite found the card's Sign-in section by the words
    "Sign-in" (`phase2-browser`), so the Safeguards section says "Shared passwords work from".

- **Every AI failure reaches the phones (2026-10-08)**: `src/credit.js`, `src/agent.js`, `public/admin.html`.
  - *What happened:* at 9:54 pm a new API key that was not scoped to a workspace made request #205's proposal fail
    with a 400 `invalid_request_error`. `noteFailure` was called, but `classify` only knew credit, a bad key and busy,
    so it returned nothing and no alert went out. Brendan: he absolutely should get a notification for an API failure.
  - *What changed:* `classify` now also knows a key or workspace refused (`permission_error`, "not scoped to a
    workspace"), a model the API does not know (`model`), an internal error or the API out of reach (`busy`), and
    anything else in the API's own error shape (`api`). `alertFor` (pure) decides each alert: credit, key and model
    at priority 5 every 30 minutes, api at 4 every 30 minutes, busy at 3 at most hourly and not marked as an outage.
    Alerts carry Anthropic's own error text. `runStructured` and `runChat` report every failed call themselves
    (`noteApi`), so all 27 callers are covered, not only the four that called `noteFailure`; the same message twice
    within 10 s is noted once. The Instance tab names the new kinds.
  - *Tests:* `scripts/test-credit.js` (46: the 2026-10-08 message, each error shape, a module's own JSON error that
    is not the API's, every kind alerting, no dashes in alert text).

- **Ask Anetix: the assistant on the board** (2026-10-08; `src/assist.js`, `src/assist-tools.js`,
  `src/assist-evals.js`, `principles/HELP.md`, `public/assets/assist.js`, `docs/ASSISTANT.md` for the design and the
  research behind it). Brendan: "an agentic chatbot ... that will help walk people through the systems they have and
  help them with suggesting requests ... That will be their forward deployed engineer, and for someone with owner
  privileges it will have full company access", "this can write proposal that will go straight to under review based
  on the chat discussion", and in a demo "a scripted explanation of what it does". His decisions: every manager gets
  the whole company (no new owner role), managers only in v1, the baseline model for every scope at first, a demo
  gets set answers only.
  - *Where.* An **Ask Anetix** button in the band of the board (`#askdock`), an **Ask** link on each tool in the band,
    and `?ask=<tool>` on the board's address; managers and Anetix admins only (the board shows the floor nothing, and
    every route answers a floor session 403). A side panel on a computer (the board moves over beside it at 1100 px
    and wider), the whole screen on a phone. Not on a tool's own pages: anything a tool page can reach is reachable by
    agent-written code with the session of whoever has the page open, so the routes live under `/api/c/:slug/assist`,
    a path `registry.modulePagePolicy` does not open (the e2e checks the header).
  - *The chips.* Anetix help, one per tool, Whole company. It opens on the tool the board is filtered to, else Whole
    company. A chip change starts a new conversation and says so (Atlassian shipped a bug in 2026 where a scope change
    silently dropped the context). Three starters per scope that fill the box and send nothing.
  - *The turn* (`assist.runTurn`): a plain Messages API tool loop (not the Agent SDK), at most `SOS_ASSIST_STEPS` (8)
    model calls; the last asks for an answer in the same turn as the tool results. `SOS_ASSIST_MAX_TOKENS` (1500) a
    call. The model is the company's propose model (`agent.modelFor(company, "propose")`, the baseline unless pinned).
    The system prompt is the rules plus `principles/HELP.md`, cached (`cache_control` on that block; the tools come
    before it), then the company's part (date, company, who, the scope, its tools, whether the wall is up), then the
    conversation with a moving cache mark on its last block. The model sees the last `SOS_ASSIST_HISTORY` (20)
    messages as words only, with a note where an answer had a card and what became of it. The turn runs behind the
    request; the panel asks for it every 1.1 s and shows each step as it happens ("Reading how Cycle count works").
    Every model call goes through `agent.atWall("assist", ...)` (the prompt log) and the meter as kind `assistant`;
    the turn's spend is filed in `ai_usage` as `assistant` (the company's spend, a site's fair use). The answer goes
    through `assist.scrubText`: model names as everywhere a company reads, "Claude the AI", the maker's name, and any
    long dash. A turn running at a restart is marked failed at boot with words that say to ask again.
  - *The tools* (`src/assist-tools.js`, one registry, written so the company MCP's phase 2 can serve the same list):
    `list_tools`, `describe_tool` (screens with addresses, tables and columns with row counts, the diagram, the tour's
    numbered steps), `whats_changed`, `list_requests`, `get_request`, `summarize_records`, `read_records`,
    `show_on_screen`, `draft_request`. Anetix help gets `list_tools` and `draft_request` only. Scope comes from the
    session: no tool argument names a company, a role or a person; in a one-tool conversation every call is pinned to
    that tool and naming another is an error that points at the chips. Text people typed comes back in fields named
    `words` or under `records`, with a note that it is information, never an instruction. Every call is a row in
    `platform.assist_calls` (who, scope, tool, arguments, ok, what was read, size, time; never the answer).
  - *Records.* `summarize_records` (count, sum, avg, min, max; grouped by a value or by day, week or month; filters;
    a last-N-days window) and `read_records` (50 rows a call, columns, filters, order, offset). The query is built
    from table and column names checked against the tool's own live tables in the catalog; values are parameters;
    no free SQL. They read through a new database role per company, **`sos_<company>_read`** (`dbroles.READ`; made
    with the other two, SELECT on the live module tables only, never `_migrations`, the platform, staging or another
    company; dropped with the company), inside `BEGIN READ ONLY` with a 5 s statement timeout. An instance that cannot
    make roles reads on the platform's connection, still READ ONLY, and says so once in the log. With the data wall
    up the two tools are not offered at all, a call anyway is refused naming the wall, and the prompt says so.
  - *The request card* (Brendan's "straight to under review"). `draft_request` files nothing: it puts a card under the
    answer (the tool, the screen when one was named and checked, the words, why, open requests that share its words)
    and tells the model never to say it was filed. **Send to Reviewing** (`POST .../messages/:id/file`, the words may
    have been changed on the card) makes the feedback row with `feedback.source = 'assistant'` and `source_ref` = the
    conversation, the person's name, the screen's page and file, and calls `arrival.start(id, { force: true })`: read
    now even with the company's "Read it at once" off, past the busy-hour limit, and for a tool whose first version is
    still a preview. The proposer sorts it as any request (a repeat folds in, a new tool or an outside connection is
    flagged or handed off) but never asks its one question (`proposals.generateProposal`: the manager just talked it
    through). It lands in Reviewing with the draft; the approval is the manager's as always. The board's card carries
    FROM A CONVERSATION, which opens it. In Anetix help the card goes to Requests to Anetix (`module='platform'`) and
    is not read by the proposer. Not now puts a card away; a card is sent once. `SOS_ASSIST_FILES_DAY` (20) a person.
  - *A demo* (any company that is not a paid site, `kind.isSite`, read at the moment): the panel, chips and starters
    show, the note says "Demo: set answers", and every question gets the set answer for its chip (`assist.setAnswer`):
    no model, no tool, no credit. What a demo user typed is kept; the Demos tab shows "What they asked Ask Anetix".
  - *Who owns a conversation.* A named account (`acct:<id>`), a person signed in with a name and a PIN
    (`person:<id>`), or the shared manager password (`role:manager`, one history for the shared login). History lists
    your own. An Anetix admin may read any conversation of a company (support) and cannot write in one.
  - *Failures.* A refused or failed call goes through `agent.noteApi` like every other caller's (the phones hear of
    it, "Every AI failure reaches the phones"), and the person reads "That did not work just now. Ask again in a
    moment.", or the credit words when the credit or a budget stopped it.
  - *Limits.* One running answer per conversation (409), `SOS_ASSIST_TURNS_DAY` (120) questions a person a day as a
    loop guard (not a spend cap; Brendan's rule of alerts instead of caps stands), 4,000 characters a question,
    `SOS_ASSIST_TOOL_CHARS` (30000) a tool's answer. `agent.assertUnderCap` before a turn, as for any AI work.
  - *Anetix's side.* The Health tab's Ask Anetix card (`GET /api/admin/assist?days=`): per company conversations,
    questions, failed answers, ratings, cards and requests sent and approved, spend; the answers rated down with the
    reason; a company's conversations and each transcript with its tool calls. **The golden questions**
    (`src/assist-evals.js`, `POST`/`GET /api/admin/assist/evals`): twelve questions through the real turn on a company
    Anetix picks, graded by code (tools called, words said or not, a card or not, no model name, no dash), spend
    filed as `assess` (out of the company's spend), transcripts kept as "Anetix evals". Run before a new site gets it
    and after any change to the prompt, a tool description, HELP.md or the baseline.
  - *The switch.* Safeguards on the company's card: **Ask Anetix** (`companies.allow_assistant`, on by default). Off,
    the config answers `{ mode: "off" }`, the board shows no button and no Ask links, every other route refuses.
  - *The record.* `chat_question` and `chat_answer` with `detail.via = 'assistant'` (scope, conversation, tools,
    card, model and cost on the answer), `feedback_filed` with `via`, `assistant_rated`.
  - *Tours.* `?tour=1&step=N` opens a tool's tour at step N (`feedback-widget.js`), for the Show me button.
  - *Tests.* `scripts/test-assist.js` (70: the words people read, the history, the request's shape, the scopes' tools,
    the read role's grants, the eval grader); `scripts/e2e/assist.js` (85, fake model: managers only, one company,
    one tool, the wall with the prompt log, a demo's set answer with no model, the read role refused writes, the
    platform and another company, typed text as data, the card filing nothing until the tap, Reviewing with read-at-once
    off, the switch, the admin view, the eval run, a tool page's policy, gone with the company);
    `scripts/e2e/assist-browser.js` (32: the panel on a computer and a phone, a demo, the floor sees nothing);
    `scripts/e2e/assist-api.js` (14: the requests a real turn sends, against a stand-in for the Messages API on 3998:
    tools, cache marks, alternating roles, every tool call answered first in the next turn, no empty text, the step
    limit, the spend filed).
  - *Known limits.* Not run against the real model yet (the sandbox has no key): run the golden questions on the live
    instance first. No streaming of the words themselves (the steps show as they happen). No memory across
    conversations. No idea cards on the board yet (v2). The tool pages carry no link to it (the widget does not know
    who is signed in); the band's Ask link per tool stands in.

- **Change it at the gate, Ask Anetix in demos, and the audit tools (2026-10-12).** Two requests from Taylor on the
  boards, and Brendan's ask for a review every four hours.
  - *Change it* (`pipeline.rework`, `POST /api/runs/:id/rework`, the board's "Not right? Change it" under the preview
    link). Taylor, Chelsea Clock: "Allow me to edit and rebuild a built change, instead of having to simply discard it
    if it's not right." Brendan's call: the manager says what is off and the agent reworks the preview it already
    built. The run is claimed from the gate in one statement (so it cannot race a change joining the preview), goes
    back to the build step in the SAME draft version (`evidence.findings_from = "manager"`, the words in
    `evidence.reworks`), the platform checks, the second review and the tests run again, and it comes back to the
    gate. The words are added to the requirement, so the reviewer holds the reworked build to them. It needs credit
    like a new build, resets the automatic fix rounds, and is capped at `SOS_MAX_REWORKS` (5) per build. Works on a
    change, a change on top of a preview, and a brand-new tool (`modulebuild` reworks version 1 in place; a Retry
    still starts a new tool over from the skeleton). On the record as `run_reworked` (before = what the preview did,
    after = the manager's words). Discard is unchanged. Tests: `scripts/e2e/rework.js` (41).
  - *Ask Anetix answers in demos* (`src/assist.js`). Taylor, from the Pearlman LLC admin page: "Make the Anetix
    chatbot helper available in demo deployments as well as live, operational deployments." Brendan reversed the
    10/08 call (set answers only) and chose to pay for it from the demo's own credit: the turn is metered as
    `assistant` in `ai_usage`, which the credit counts. A demo whose credit is used up gets a 402 in words before
    anything is stored or run. `SOS_ASSIST_DEMO=scripted` brings the set answers back. Conversations keep
    `demo = true`. Tests: `scripts/e2e/assist.js`, `assist-browser.js`.
  - *The audit tools* on the admin MCP: `activity_since`, `list_assistant_conversations`, `list_board_requests` (see
    `docs/MCP.md`). A scheduled review calls them at 7, 11, 3, 7 and 11 Eastern and pushes a summary to Brendan's
    phone every run. Report only: the MCP still changes nothing. Tests: `scripts/test-mcp.js`, `scripts/e2e/mcp.js`
    (canaries for an assistant answer that read records, a check's words, a chat persona's answer).
  - *Known limits.* Change it is not tried against the real model yet. The audit reads a paying site only up to the
    day it went live unless it opted in to learning (the Terms, 10.2); none are subscribed yet.

- **Notices fold into one line; switch a site on by hand, payment to follow** (2026-10-13; `src/notices.js`,
  `public/index.html`, `src/activate.js` switchOn/switchOff, `src/kind.js`, `public/assets/admin-sites.js`). Brendan,
  looking at seven "Anetix put a change live" cards stacked on Chelsea Clock's board: "These notifications should not
  be taking up so much space, when there is more than one it looks terrible and we should be able to clear it. Also
  chelsea should not longer be on the demo view even though the payment has not processed yet as we need to start
  rolling it out on the floor, I will need to have the option to activate companies on my own."
  - *Notices.* However many there are, one slim line: the newest, cut to one line, with "N updates from Anetix", Show
    all (a list that scrolls past six) and Clear all (`POST /api/c/:slug/notices/seen-all`). One notice is one line
    with a close mark. A manager OR an admin closes them now (Anetix runs some boards itself for now); `seen_by` keeps
    who. The Terms' 9.1 duty is to tell the manager: on a customer's board, Anetix should leave a notice their manager
    has not read alone.
  - *Switch on by hand.* The Sites tab, on any company that is not paying: "Switch on now, payment to follow" (a fresh
    code or passkey, an optional note, sample data out by default). `platform.sites.switched_on` `{ at, by, note }`;
    `kind.isSite` and `agent.subscribedSite` read it, so the company is a site at once: no sample data or its links,
    the floor's wording, its managers can add managers, Ask Anetix in live mode, no company cap, out of the replays
    and the Demos tab's learning (`checks.js`, `assess.js`), refused by delete. `converted_at` marks where the plant's
    data starts. The rollover runs WITHOUT the floor-password step: the floor keeps the password it has, nobody is
    signed out. The stage is not touched, so the pilot offer stands and the payment comes by the usual road (order,
    signature, card, Activate). `finish()` clears `switched_on` and keeps the rollover's marks (`paid_at` added), so
    Activate never hands the floor a second new password; its plan says so. "Switch back to a trial" undoes it while
    nothing is paid (`POST /api/admin/sites/:slug/switch-off`); a paying site ends through its subscription. The Sites
    tab's stage reads "On, payment to follow". `kind.standardize` leaves a switched-on company alone.
  - *Found on the way.* The rollover's sample step called `sample.clear`, which refuses a company that already counts
    as a site, so Activate could log "not cleared" and leave made-up rows on a paying floor. `clear(..., { goingLive })`
    skips that check for the rollover only.
  - *Tests:* `scripts/e2e/switchon.js` (29: switch on, the floor still signed in, sample data out, the offer standing,
    switch off and on again, then the order, card and Activate with the floor's password kept; seven notices, one
    closed, Clear all, the floor refused). `stage3.js`'s notice case is the new rule. pricing (82), stage3 (116),
    billing (50), sample (41), managers (40), standardize (19) pass.
  - *Known limits.* A site on by hand has no end date: nothing sends it back to a trial if the payment never comes,
    that is Anetix's call on the Sites tab. Its fair-use line does not apply until Activate (no period yet).
- **The company MCP (2026-10-13)** (`src/mcp-company.js`, `src/mcpauth.js`, `src/assist-tools.js`, `public/settings.html`,
  `public/connect.html`; the design and what changed from it are `docs/MCP.md`, "Phase 2"). Brendan: "build phase 2,
  but ensure it is properly aligned", asked when he wanted Claude to keep Anetix's own CRM and action items (tools on
  the `anetix` company) in step.
  - *What it is.* `https://app.anetix.ai/mcp`: a manager of a paying site (or of a trial Anetix names in
    `SOS_MCP_TRIALS`) adds it to their AI app as a custom connector, signs in with their own account and a fresh
    passkey or code, and the app reads the company's tools (`list_tools`, `describe_tool`), what changed, the board
    (`list_requests`, `get_request`) and, with the manager's records switch on, the records (`read_records`,
    `summarize_records`, through the company's read role). Its one write, `file_request` (only on a connection ticked
    to file), puts a request on the board in the manager's name. It edits no row, approves nothing, builds nothing.
  - *Decisions kept (2026-10-05):* reads and files requests, never a row edit; records are the manager's own switch,
    off by default, independent of the data wall; a filed request waits for the manager's tap; Anetix can lock the
    records switch off (/admin, the company card's More); paying sites only; no added cost.
  - *Held requests.* `feedback.held` on a filed request until a manager presses Review with AI or Review all:
    `arrival.claim` refuses it, the duplicate check and the system review leave its words out, Ask Anetix and the
    admin MCP show that it exists, not its words. The tap clears it (`proposals.generateProposal`,
    `mcp_request_released` on the record) and the loop goes on as for any request, with no question asked of nobody.
  - *Screens.* Settings: the card "Connected AI apps" (the address with Copy, the records switch with its step-up,
    every connection with Disconnect, the last 25 calls). The board: a FROM <APP> chip and a line saying it waits. The
    consent page names the company and what records it may read. /admin: the lock and the count on the company card,
    whose company on the Accounts tab's connected apps, `connected_apps` in the admin MCP's `list_companies`.
  - *Rules it keeps.* The company comes from the token and is checked again at every call; an admin account connects
    to the admin address only and a manager to its company's only; a connection keeps the admin windows (7 days idle,
    30 days cap); a company that stops being a site is refused but keeps its connections; Disconnect, Sign out
    everywhere, switching the account off or deleting the company end them. Every answer is scrubbed of model names and
    AI costs except the company's own rows. Every call is in `platform.mcp_calls` with its company.
  - *Tests:* `scripts/e2e/mcp-company.js` (68, in run-all as mcp-company: the design's proof list and the screens'
    routes), `scripts/test-mcp.js` (76), `scripts/e2e/mcp.js` (the manager's refusal on the admin address now names
    the company address).
  - *Known limits.* Not changed: the Terms sentence on data read through a connector (a new Terms version; for HLEP).
    The golden questions were not rerun (no API key in the sandbox); run them on /admin, Health, since HELP.md
    changed. Nothing here has met the real Claude on the company address yet. Writing records is the next step Brendan
    named, and needs his word on decision 2.
- **The outside audit 1A: sign-in fixes (2026-10-13)** (`src/auth.js`, `src/accounts.js`, `src/passkeys.js`,
  `src/mcpauth.js`, `public/assets/passkey.js`, `public/enroll.html`). Astra's Phase 1A report
  (`Audit/findings/1A.md`, on `a404a46`) found company isolation sound and three sign-in holes. All three were
  replayed with copied cookies before the fix (they reproduce) and after it (closed).
  - *S1-01, Critical: a password-only session became a full one.* An account with no second factor signed in with the
    password alone into a session that was restricted only by the account's CURRENT state, so a session someone got
    with a known password became a full admin or manager session the moment the real person finished the setup in
    another browser. Now the cookie has a seventh part, a tag (`n` full, `e` enrollment-only, then a random nonce,
    inside the signature). A password, a sign-in ticket or an invitation on an account with no factor gives an
    enrollment-only session: the setup pages only, 60 minutes from sign-in (`auth.ENROLL_MINUTES`), never refreshed,
    and over the moment the account has a factor, whichever browser set it up. The browser that proves the factor (the
    app's first code, or a manager's first passkey) gets a full session in the same answer (`auth.finishEnrollment`),
    and the enrollment-only one it held is revoked.
  - *S1-02, High: a stolen session could add its own passkey.* Any live session of an enrolled account could register
    a passkey, which then signed in on its own, survived Sign out everywhere and answered admin step-ups. Now adding
    a factor to an account that has one (a passkey; the app on a passkey-only manager) takes a fresh proof of a factor
    it already has, in the request that begins the adding: its passkey (`/api/me/passkeys/step-up/options`), a fresh
    code from the app, one of its recovery codes, or its password under break glass
    (`accounts.proveForNewFactor`). The permission is bound to the session and used once: the passkey's challenge
    carries the session's id and `register` refuses another session; the app's setup remembers which session started
    it for ten minutes and `enroll/verify` refuses another. One exception, so the setup flow stays one step: the next
    factor added within ten minutes of the first setup, from the browser that did it (the passkey offered right after
    the app), needs no second proof (`accounts.grantNewFactor`, once). The pages ask on their own: `Passkey.add()` and
    the "Add the authenticator app" page call `Passkey.confirm(via)`, which uses the passkey when there is one and
    otherwise asks for a code (or a recovery code) in a prompt.
  - *S1-03, Medium: logging out left copies of the cookie working.* `/logout` only told the browser to drop it; a copy
    kept working up to its cap (30 days admin, 180 floor and manager). Now a session has an id (`sid`: a hash of role,
    slot, generation, issued and the nonce, the same through every refresh), `/logout` writes it to
    `platform.revoked_sessions` (kept until the cap, forever when there is none; pruned at boot), and the middleware,
    `currentSession` (anetix.ai's who-am-I) and the consent page's `mcpauth.accountOf` refuse it. Remembered ten
    seconds per id in other processes, at once in the one that wrote it. A cookie from before this change has an empty
    nonce and an id of the same kind, so nobody was signed out by the deploy and logging out still ends its copies.
    Only that session ends: the account's other sessions and a company's other floor devices carry on.
  - *Tests:* `scripts/e2e/audit-1a.js` (46, in run-all as audit-1a: each finding replayed as the report did it; on the
    code before the fix 22 of them fail, including every "the finding: 200"), `scripts/test-accounts.js` (+14: the
    tag, enrollment-only lifetime, the id through a refresh and from a six part cookie), `scripts/e2e/passkeys-browser.js`
    (now proves a factor before a second passkey, answers the code prompt, and checks that adding the app on a
    passkey phone asks for the passkey first).
  - *Known limits.* A person who knows an account's password before its first factor exists can still race the real
    person to set one up (the report names that prerequisite; the cure is not handing out passwords for accounts
    that are not set up, which the sign-in ticket and invitation flows already avoid). The prompt for a code is the
    browser's own box. Revocations are checked against the database every ten seconds per session in a second
    process, so a logout reaches another process within ten seconds.

- **The web connection (2026-10-13)** (`src/connections.js` the web kind and `platform.web_jobs`, `src/agent.js runWeb`,
  `src/runner-child.js` and `src/runner.js` conn.web.*, `principles/MODULE-CONTRACT.md` "web"). Brendan's own CRM
  tool ("One lead", company Anetix Inc) asked for "an auto web scrub to fill initial information, maybe giving a few
  different options" and a trigger line from the company's page. The platform had no way out to the web, so the
  proposer filed it to the integration team as kind "other". Brendan: handle it on our end, no extra guard rails for
  now. So the web is a fourth connection kind, owned by the platform like the others, and turned on per tool like the
  ERP and the printer (`connections.OUTSIDE` is erp, printer, web): the builder is told, the module gate refuses a web
  declaration a build adds while it is off, the proposer and the new tool design hand it off as kind `web`. Nothing
  else holds it: no list of allowed sites, no approval per look-up, no limit beyond the company's AI budget.
  - *How it reaches the web.* Through Anthropic's own server tools, `web_search_20250305` and `web_fetch_20250910`
    (no beta header; `SOS_WEB_SEARCH_TOOL` / `SOS_WEB_FETCH_TOOL` to move to a newer version), on the company's propose
    model. The searching and reading happen on Anthropic's side, so no address a tool names is ever fetched from this
    instance and a tool cannot use the web to reach the private network (Postgres, the scanner, anetix-www). web_fetch
    reads only an address that is in the question or came back from a search, so the tool's start pages (`urls`) go
    in the question. A `pause_turn` is sent back unchanged to carry on (six calls at most). The answer is the text
    after the last tool result; sources are what it cites, then what it read, then what the searches found (20 at
    most). With `json: true` the system prompt asks for one fenced JSON value and it comes back as `data`.
  - *The surface* (`ctx.connections.<name>`): `start(question, { urls, json, guidance, max_searches, max_fetches })`
    answers `{ id, status: "running" }` at once; `result(id)` answers `{ id, status, answer, data, sources, searches,
    pages_read, error, started_at, finished_at }`; `research(question, opts)` waits for the whole thing (in the tool's
    process it starts and asks every 2 s, because a look-up can outlast both a tool request, `SOS_MODULE_TIMEOUT_MS`,
    and one question on the private channel); `status()` answers `{ connected, last_used_at, error }`. A look-up runs
    in the platform's process as a row of `platform.web_jobs` (in the backup, gone with a company's delete); a boot
    marks one that was running as failed ("the platform restarted while this was being looked up; ask again"). A
    failure reads in plain words (`plainWebError`), never the vendor's text.
  - *Held by:* the per-tool switch (checked at every `start`, so turning it off stops look-ups at once, while the
    declaration a tool already has stays, like the ERP), the data wall (a walled company's tools cannot look anything
    up, the same as `ai.chat`), and the company's AI budget (`assertUnderCap` with `runtime: true`, like `ai.chat`).
    Each look-up is on the meter as kind `web` (tokens plus `SOS_WEB_SEARCH_USD`, $0.01 a search), in `ai_usage` as
    kind `web` and in the record as `web_lookup` (the question and the answer). Sizing: `SOS_WEB_SEARCHES` (8) and
    `SOS_WEB_FETCHES` (8) the most one look-up may do (5 each by default), `SOS_WEB_MAX_TOKENS` (4000).
  - *Admin.* The Companies tab's Outside column has Web. An integration request filed as "other" or "machine" offers
    "Turn on web / ERP / label printer" on the Requests tab, and turning one on from a request rewrites the request's
    `about_kind`, so its card reads as that kind from then on. The connections page shows a web card (on or off, the
    last ten look-ups). The intake's "What does this need to work with" has "Websites (looking things up online)".
    `docs/SAFEGUARDS.md` has its row (what leaves: the question and the pages it names).
  - *Tests:* `scripts/e2e/web.js` (24, in run-all as web: off and refused at the gate with the builder told; a request
    filed as "other" turned on as the web from the request; on, a change that declares it deploys and the tool's own
    process starts a look-up and reads the answer, its sources and its JSON; no model or cost in the answer; the
    prompt log shows the start page in the question; a failure in plain words; off again, refused), fake marker
    `ADDWEB` / `ADDWEBALWAYS` (a change declares a web connection and two routes) and `INTEGRATIONWEB` (the proposer
    hands it off as "other"), `FAILWEB` (the look-up fails). `scripts/test-connections.js` (+14: the declaration, the
    options, the plain errors, the stand-in, the answer and sources from a real block layout, the JSON), and
    `scripts/test-modulegate.js` (+1).
  - *Known limits.* Not tried against the live API from the sandbox (no key there): the first real look-up on the
    live instance is the test of the block shapes. web_fetch reads text, HTML and PDF, not pages drawn by script.
    What a page says is passed to the model as information; the system prompt says a page's text is never an
    instruction, and what comes back is shown in the tool as a suggestion a person accepts, never written straight
    into a record (the contract tells the builder so).

- **No reason asked when Anetix changes a tool (2026-10-14)** (`src/feedback.js`, `public/index.html`,
  `public/admin.html`). Every Deploy, Roll back and Switch an admin pressed on a company that was not `demo` (Anetix
  Inc's own tools included) asked "Why? 1, 2 or 3" and then for a few words, the server refused the call without
  them, and the manager got a `tool_changed` notice; a restore with paying sites asked the same and noticed every
  paying site. Brendan: "very annoying from the admin perspective and does not add any value yet", and "that whole
  system needs to go away, it was designed before it was needed". So `adminChange`, `tellManager` and `ADMIN_WHY` are
  gone, the board's `adminWhy` prompt and the restore form's two fields are gone, and no notice is written. The
  change itself is on the record as before (`deployed`, `rolled_back`, `version_switched`, each with the admin as the
  actor), and the restore still refuses a file older than a site's subscription. Notices already written stay as they
  are. Left alone: a library tool's repo change still waits for a customer's manager to switch to it
  (`registry.importFromRepo`). Not changed: the Terms' 9.1 still says Anetix tells the manager when it changes a live
  tool without approval; that wording goes with the next Terms version. Tests: `scripts/e2e/sample.js` (an admin's
  deploy goes straight through and writes no notice), `scripts/e2e/stage3.js` (the two refusals out; a restore writes
  no notice).

- **The tool library across companies: copy a tool, templates, the standard package (2026-10-19)** (`src/library.js`,
  `platform.library_templates` and `platform.library_copies`, the Library tab and the company card's Add a tool on
  `public/admin.html`). Brendan: two people in the pipeline wanted an example tool, and the examples were at other
  companies (a CRM at Anetix Inc, a production dashboard somewhere else); he wanted every tool searchable, a sample
  set sent to one prospect, and "a global that shows all tools that are just the framework, then we can make a
  standard package of tooling, of the most common software solutions". Before this a company-made tool lived only
  at the company that made it, and only the two repo modules could be added anywhere.
  - *What it does.* The Library tab (out of More, a main tab now) has one search box over every tool and template:
    title, address name, description, screen names, and every company it is at or came from. Under every instance of
    a tool: Copy to a company, and Save as template. A copy is the version on the floor (else the preview) put on the
    other company as a new tool, version 1, live, with EMPTY tables (source `copy`, the notes name where it came
    from). A template is a frozen copy kept in `platform.library_templates`, apart from the company: it does not move
    when that company keeps building and stays if the company is deleted. A template carries a title and a
    description of its own and a Standard switch; the standard ones are the standard package. On a company card, under
    More, Add a tool: tick several templates (a sample package for one prospect) or Add the standard package. A
    template a company already has a live copy of is skipped. A company that is not a demo asks first.
  - *Only code travels.* The Terms put it this way already: Anetix owns the modules, the company owns its data. A copy
    never reads the source's tables; rows arrive only when a migration file itself inserts them. Not carried: outside
    connection switches (off at the new company until Anetix turns them on), feedback, builds, the record, agent docs
    other than the tool's own reference and personas. A company with a finished brand guide gets a restyle build, as a
    repo tool does.
  - *The check before anything leaves.* `library.check` (pure) reads every file for what is the source company's own:
    its name (whole, and each word of five letters or more), email addresses (not example.com or anetix.ai), phone
    numbers, rows a migration inserts, `ctx.peer` reads of another tool (it shows nothing unless that tool is at the new
    company under the same name), and outside connections. The copy and save dialogs show the list before the button;
    a template keeps the list it was saved with ("N things of X's, see"). Only addresses are changed on the way:
    `/c/<from>/` and `/m/<old name>` become the new company's and the new name (`library.rewrite`). A name, a contact or
    a row that should not travel is changed on the source company's board first. A Chelsea Clock or Habco tool is the
    case to look at twice.
  - *Names.* The tool's own address name, else -2, -3 where it is taken at that company, or its tables would clash
    (`migrate.schemaClash`), or it is the name of a repo library tool (the boot import would otherwise bring the repo
    copy over it: demo's evolved Paper Airplane Line copies as `paperline-2`).
  - *The gate.* A copy is new code on a floor, so it is held to the module gate as a new build is; a tool whose old
    code the gate refuses today is refused with the gate's words and nothing is half made (rows and tables go).
  - *Admin only, on the record.* Every route is `requireAdmin`; `module_copied`, `template_saved`, `template_changed`,
    `template_deleted` events and a `tool_copied` record line at the company. Both tables are in the backup. Deleting a
    company deletes its copy history, never a template saved from it.
  - *Tests.* `scripts/test-library.js` (15: the check and the rewrite), `scripts/e2e/library.js` (25: the check, a copy
    live with empty tables and rewritten addresses, -2 and paperline-2, a standard template frozen against the source's
    v4, the package and its skip, the gate refusal, delete keeps the copies), in `run-all.sh`.
  - *Not done.* The module creation intake still starts blank (the 2026-09-17 decision); starting a new tool from a
    template there is the next question. No AI pass that strips a company's words from a template; the check lists
    them and a person decides. The admin MCP has no template tools yet.

- **Shop Schedule, a library tool built by hand, and the tools a pin's company starts with (2026-10-19)**
  (`modules/shop-schedule/`, `principles/module-formats/shop-schedule.md`, `src/selfserve.js` pins and createCompany,
  `src/library.js` cleanStarters / starterTitles / addStarters, the Pins tab of `public/admin.html`). Brendan, after a
  plant walk at a machining and fabrication shop: "I need something where they are getting a good basic scheduling
  module when they log on ... a way for when they logon to see something that is working", built by hand "and save me
  the API tokens". A demo used to land on an empty board, and the first tool cost a build.
  - *What the shop said it needed, and where it is in the tool.* The schedule showed infinite capacity: the plan
    places every operation on its work center's real hours a day, highest priority first, so no work center is ever
    booked past what it has and a constraint (the over-booked lathe) shows as weeks booked full on Load and a red
    banner on the board. Start dates moved every day, so nothing was late until the end: every operation's start date
    is locked at release and only a manager moves it, with a reason on the job's history; a waiting operation past its
    locked start is a missed start, red on the board, the job, the work center and the meeting. On time was counted
    at the shipping door: the commit date is the customer's dock date, and the projection adds the days from the
    door to the dock. "I see the date, I need to click down one layer": the job page says what is done and what is
    left (hours in the shop, outside processes) and where the plan puts it. Nobody knew what was on the lathe: each work
    center's tablet page has what is running, what is here and ready in order (NEXT UP), what is held and what is
    coming, with Start and Done. The meeting was "shaggy dog stories": the morning meeting page is facts (part,
    quantity, dates, last and next operation) with every held job's owner and date, or a red "no owner" / "no date".
    The wait between operations is measured from the floor's taps (average on the board, per operation on the job).
  - *The example shop.* On the first request, 11 work centers, 16 open jobs and 6 shipped ones, dated from that day:
    the lathe booked full, two outside processes, three held jobs (material, a drawing, a purchased part), a few late
    and a few with missed starts, on time 3 of 6. Setup takes it out (the example jobs, and the unused example work
    centers if ticked) and puts it back; once out it never comes back on its own. Nothing in it names a real company.
  - *Built by hand, held to the same rules as a build.* Passes the module gate and the migration validator; two
    checks (`checks/001`, `checks/002`); a tour; the reference doc for the agent. Every page is built from one shared
    head and helper script (the generator is not in the repo; the pages are plain files). As a repo library tool it is
    added to company `demo` at boot and is addable to any company from the Library tab, a company card or a pin.
  - *Pins carry starter tools.* `platform.access_pins.tools` (`[{ repo }]` or `[{ template }]`), ticked under "On their
    board from the start" when the pin is made, or changed on the Pins tab until the pin is used. `createCompany` puts
    them live right after the company is made (`library.addStarters`: a repo tool through `importFromRepo` and the
    mount, a template through `addTemplate`); one that fails is logged and the company is made all the same. The pin
    message then tells them to open those tools instead of pressing "+ New tool" first.
  - *Tests.* `scripts/e2e/shop-schedule.js` (57: the example, the numbers, no work center past its hours, the floor's
    Start and Done and Can't run it, the manager's release, priority, re-lock and commit date with reasons, ship and
    undo, work centers, the example out and back, every screen), `scripts/e2e/starter-tools.js` (13: the pin's tools,
    the message, the company made with them live and the example in, the change before use and the refusal after),
    both in `run-all.sh`; the module's own checks run against it (2 of 2).
  - *Rev 1 leaves out on purpose.* People and shifts as a constraint, material from purchase orders, an Epicor
    connection to read jobs and routings, setup times, splitting a job across machines. They come through feedback.
- **Steps that need judgment: rules where the cases are known, the tool works it out where they are not (2026-10-20).**
  Taylor's CRM (Pearlman LLC, company `demo`) asked seven times in one morning for "upload my sales report template
  and fill it" (requests 270 to 279). Every build matched the template's headings with a fixed list of other names
  ("Client" for company), which passed the example and missed the next template; four were cancelled and the fifth
  waits at the gate. The platform has lent tools an AI call since 2026-09-27 (`ctx.ai.chat`), but the contract
  described it only as a chat persona, the proposer never decided how a change should decide, and the builder always
  reached for fixed rules. Brendan: "The default building goes to deterministic which often ends up being wrong. We
  also do not want to make it too confusing to the operator."
  - *The proposer decides, the manager never picks.* Every proposal now carries `approach` (`platform.proposals.approach`,
    JSONB): `how` is `rules` (every case can be written down ahead of time), `judgment` (the tool reads something
    new each time and decides) or `match_once` (the first time a new template, layout or file arrives the tool works
    out the match, shows it to the person to check or fix, saves it, and fills by rules after that), with the `step`
    that needs it and `why`. The test it is given: could a careful person write down every case ahead of time from
    what the tool holds? Reading anything a person uploads, pastes or types in their own words and lining it up with
    the tool's fields is never rules. `match_once` is preferred whenever the thing repeats (cheaper, steadier, a person
    checks it once). A change with judgment or match once is always a functionality change. The proposal and rationale
    say what the person will see ("the tool reads your template's headings and matches each one to a CRM field
    itself, shows you the match to check once, then remembers it"), never the way it is built: the brief forbids the
    words, and `deterministic`, `agentic` and `heuristic` joined the plain-words guard (`src/plainwords.js`,
    `principles/PLAIN-WORDS.md`). The one question on arrival may never ask how to build; when the choice changes what
    the person gets and their words do not say, it asks about what they will see ("When a heading in your template does
    not match a CRM field by name, what should happen?").
  - *What the build is told.* `pipeline.proposalsText` adds a "How it decides" line per change (the requirement and the
    reviewer read it too), and a build with a judgment or match-once change gets `judgmentBrief`: use `ctx.ai.judge`,
    never a list of other names, a fuzzy score or keywords; one call per new thing, never per row or page load; save a
    match beside the thing it is about and show it with a select per line; treat the answer as a suggestion and check
    it; catch a refusal and let the person do the step by hand. A walled company's build is told the by-hand path is
    the one that works today. The head-to-head assessment builds with the same prompt.
  - *`ctx.ai.judge({ task, input, answer })`* (`src/registry.js judge`, lent over the tool process's channel as
    `ai.judge` in `src/runner.js` and `src/runner-child.js`). `task` is what to decide in plain words (4,000
    characters), `input` text or JSON (60,000 written out, `SOS_JUDGE_INPUT_CHARS`; the refusal tells the tool to send
    headings and a few rows), `answer` a JSON schema (8,000). It is one structured call on the company's propose model
    (`SOS_JUDGE_MAX_TOKENS`, 4000), answers `{ data }` in that shape, refuses with a 409 and plain words while the
    company is walled off from the AI, runs under the runtime cap like chat, is metered as usage kind `judgment`, and
    goes on the record as `judgment` (the task and the answer, cut to 2,000). Fake mode answers the smallest value that
    fits the schema (`agent.fakeFromSchema`). Checks never call it (GUARDRAILS.md).
  - *New tools.* The design brief (`intake.js JUDGMENT_DESIGN`) says where the tool works something out, in what the
    manager sees; the question rounds never ask the manager to choose between fixed rules and the tool working it out.
    `principles/MODULE-CONTRACT.md` has "Steps that need judgment" with the call and the match-once shape for a first
    version's build, and `principles/PRINCIPLES.md` 11 is the rule every proposer, designer, builder and reviewer reads.
    Ask Anetix knows it (`principles/HELP.md`, How a request becomes a change).
  - *Watching the experiment.* `proposal_drafted` on the record carries `approach` and `approach_step`, and the admin
    MCP's `activity_since` passes both through, so the four-hourly review shows which way each change was sent.
  - *Tests.* `scripts/test-judgment.js` (29: the approach kept to its shape, the build lines and brief, the call's
    argument check, the fake answer's shape, the plain-words guard), `scripts/e2e/judgment.js` (16: a template upload
    proposed as match once and built with the brief, an ordinary change proposed as rules and built without it, the
    manager's words naming no way of building, the call's answer, record and plain 400, and the 409 while walled), in
    `run-all.sh`.
  - *Known limits.* A judgment is awaited inside the tool's request, which has 30 seconds (`SOS_MODULE_TIMEOUT_MS`):
    a small match takes a few seconds, a large one can run out; the brief keeps it to headings and a few rows. Only new
    proposals carry an approach; a proposal drafted before this (CRM v13 at the gate) is built as it was asked. Whether
    the proposer picks well is the experiment: read `approach` on the record against what Taylor and the floor say.
- **The pilot's order form, trimmed for Chelsea Clock (2026-10-23)**
  - *Brendan's decisions.* Before Arthur signs, the pilot's order form and price screen drop the sales tax words, the
    fair-use line, the learning line, the after-the-pilot line and the unused demo credit line. The pilot starts on a
    date Customer and Anetix agree (Activate is pressed that day) instead of "the day Anetix switches the Site on", and
    the price screen's "within 24 hours" line goes. On site and Integrations are the offer's own lines (Sites tab).
  - *What changed.* `src/sites.js` pilotText and pricingView's pilot branch. `src/fairuse.js`: a pilot site is never
    paused at the fair-use line (`fair_use_reached` is still recorded, with `pilot: true`). `src/golive.js`: the board's
    line once a pilot order is in. www `internal.js`: a pilot's subscription is made without Stripe Tax, since its form
    names none. www `pages.js`: no learning box or note on a pilot (a pilot never learns), and the card and order-is-in
    pages say the start date. Price book subscriptions and their form are unchanged.
  - *Still true.* At the pilot's end the site goes back to a demo and the floor's sign-in closes unless a new offer or
    Go live is activated first; the form no longer says so. The phone is told a week before.
  - *Tests.* `scripts/test-pricing.js` (66), `scripts/e2e/pricing.js` (82), `scripts/e2e/switchon.js` (29), www
    `e2e-activate.js` (74), `e2e-golive.js` (56), `test-www.js` (152). www `e2e.js` has 9 failures that are there
    without this change too (the wall and refill cases, likely the 10/22 front page).
- **The floor PIN: the floor signs in with a PIN, only on the plant's wifi (2026-10-29)**
  - *Why.* On 2026-10-28 at Chelsea Clock a manager added a person on the People page, and a phone that opened the
    board's link typed that person's new PIN into the floor's password box six times (Railway's log: 16:11 to 16:13
    UTC) and was told "That password did not match." The login took only the company's shared floor password; a
    person's PIN only names who is at a device that is already in, and nothing on the screen said so. The page also
    threw away the server's own words: an off-network refusal read "did not match" too. Brendan's decisions the next
    morning (the Requests tab, #291, and the build brief `claude/build-brief-chelsea-floor-round-2026-10-29.md` in the
    Anetix project): drop the shared floor password, the floor signs in with a PIN; only on the plant's wifi; a week
    on a device; a site starts on one common floor PIN and moves to a PIN per person later; managers and admins use
    their own account and a second factor.
  - *What a floor PIN is.* 6 to 8 digits (`auth.validFloorPin`); one the platform makes up is 6 and never a run or a
    repeat (`auth.generateFloorPin`, `auth.guessable`). `auth.setPasswords` takes nothing else for the floor and
    refuses a guessable one in words; `platform.company_access.floor_pin` says the floor's hash is a PIN. Every place
    that makes a floor credential makes a PIN: a company by hand (`POST /api/admin/companies`), Floor PIN and
    passwords on the company card (`POST /api/admin/companies/:slug/access`, `floor_pin`, or `generate: "floor"` for a
    PIN alone, leaving the manager password as it is), the rollover when a site goes live (`src/activate.js`, the
    welcome is "Show the floor PIN") and a site from anetix.ai (`src/selfserve.js`). A floor password from before
    PINs (`floor_pin` false) keeps working as it did, with an amber line on the card, until the admin makes a PIN.
  - *Only from the plant.* A floor PIN signs in only from the company's network list (`src/safeguards.js`,
    `whereFrom`): off the list it is the usual off-network refusal; with NO list it is refused as well
    (`floor_no_network`, `safeguards.NO_NETWORK`: "this plant's network is not set up yet"), in the same words
    whether the PIN was right or wrong, and a floor device of such a company is refused on every request (the
    gate's own page says the plant is not set up). The company card goes red ("floor PIN, no plant network") until
    the list is set. A shared manager password and a named account are untouched by it.
  - *Counted per device and per plant.* A plant is one address, so the per-address limit (10 in 15 minutes) would
    have locked every device on the floor out between them. A sign-in to a company from its own network list skips it
    and is counted per device instead (`sos_fdev`, a cookie of its own on `/login`: `SOS_FLOOR_DEVICE_FAILS` 5 wrong
    and that device waits `SOS_FLOOR_DEVICE_LOCK_MIN` 5 minutes) and per plant (`SOS_FLOOR_COMPANY_FAILS` 40 wrong in
    `SOS_LOGIN_WINDOW_MIN` and the plant's shared sign-in pauses for the rest of the window, one phone alert, the
    `floor_pin_paused` event). Devices already in keep working through a pause. A guesser who throws the cookie away
    meets the plant's count, and has to be on the plant's wifi to try at all.
  - *A week.* The floor's session has its own window, the person cookie's: `SOS_FLOOR_IDLE_HOURS` 168 sliding,
    `SOS_FLOOR_CAP_HOURS` 720 (`auth.windowFor`). A manager's stays 30 days idle and 180 at most.
  - *The login page.* `/login/mode` answers `pin` for a company whose floor signs in with a PIN, and the page shows a
    number pad, "Signing in to <company>. Type the floor PIN." and one line that says the person's own PIN goes in
    after, when they tap their name. Every refusal carries a `code`, and the page says the server's own reason for
    the ones that are not a plain mismatch (off the wifi, plant not set up, a wait). A wrong PIN says "Use the floor
    PIN your manager gave you. Your own PIN goes in later, when you tap your name."; a PIN typed where a floor
    password goes, or into the account form, is told apart (`pin_in_password_box`, `pin_in_account_form`). The
    People page's How it works says which PIN is which.
  - *Not yet.* A person's own PIN signing a device in by itself (the per-person stage), and the module code being
    told who is at the device (`ctx`), come with Chelsea's move to per-person PINs. A company made by hand still gets a
    shared manager password beside the floor PIN; Take it away (Safeguards) once a manager account works.
  - *Tests.* `scripts/test-floorpin.js` (23: what a PIN is, the made-up ones, the windows, the counts),
    `scripts/e2e/floorpin.js` (the whole path above, and in a browser the number pad, the off-network words instead
    of "did not match", and the 2026-10-28 case), in `run-all.sh`.
- **A tool's line is its name, Screens and Settings; a QR code for every screen (2026-10-29)**
  - *Why.* Brendan, 2026-10-29, from Chelsea Clock's requests #291 and #294: "there needs to be a pathway to get a QR
    code of every single tool", printable and at a size picked per station, each opening one screen (the MO Board's
    landing screen is for managers, the floor needs its own); and a tool's line on the board had too many options
    ("Inventory Request v3 Open live · Screens · Diagrams · Versions · Ask"), so it should be the name, Screens and
    Settings, with a popout for the rest. Operators should see only Feedback on a tool's screen.
  - *The line.* `public/index.html` render: a tool is its name (the filter toggle when there are several), Screens and
    Settings; "being built" until it has a version. Settings (`toolMenu`) is a popout in the body, outside the band so
    the 4 second refresh never redraws it away, with the version, Open live, the waiting preview (amber, and a dot on
    Settings while one waits), the test floor, Diagrams, Versions, Ask about this tool and Sample data, each only where
    it was shown before. A click elsewhere or Escape closes it.
  - *QR codes.* Screens' popout has a QR codes tab (`openCodes`): every screen of the live tool, floor screens first,
    each with its code, a size (2, 3, 4.5 or 7 inches), Print, Open and Copy link. `GET /api/c/:slug/qr.svg?path=`
    draws a code for one screen, and only a screen of that company's own tools (`/c/<slug>/m/<tool>/...`, no climbing,
    no second slash, 200 characters at most; anything else is a 400). A device that is not signed in goes to the
    floor PIN and lands on that screen after (the login page's `next`). A screen whose route has a `:param` (one
    station, one work center) gets a code per item from the tool's own list when the manifest names one (`"each"`),
    else a box to type which one, starting from the value the page check uses. Print opens a sheet with each code at
    its size, the company and tool over it, the station big, and one line on how to use it.
  - *Who a screen is for.* `principles/MODULE-CONTRACT.md` and the build brief (`src/modulebuild.js`) now ask for
    `"for": "floor"` or `"office"` on every screen in module.json, and `"each"` (a GET of the tool's own `/api/` that
    lists the items) on a one-of-many floor screen. `pageload.screenPaths` passes them through checked (the two words
    only, and an address of the tool's own API only) and the board hands them to the page. Tools already live carry
    no tag until a build adds it; their screens are listed all the same, untagged ones between floor and office.
  - *The floor sees Feedback only.* `/api/c/:slug/who` says whether the device is the floor's (`device`), and the
    widget keeps the "Improvement board" link on a tool's screen hidden for the floor; a manager still gets it.
  - *Tests.* `scripts/e2e/screens-qr.js` (25: the address check, the route and tag on the board, the manifest's tag
    and list checked, /who, and in a browser the line, the popout, the codes, a station's box changing its code, a
    one-code and an all-codes print sheet at their sizes, a phone), `scripts/e2e/board-browser.js` (the floor without
    the board link, a manager with it), and the line's other suites moved to the popout (`assist-browser.js`,
    `firstrun-browser.js`, `testfloor-browser.js`).
- **Small fixes from Chelsea's first weeks: round corner icons, the company's own icon, pointing at something for Anetix, several new tool drafts (2026-10-29)**
  - *#292, "Feedback and improvement board keep getting in the way of buttons".* `public/assets/feedback-widget.js`:
    floating, the Feedback button is a 44 px round icon (whoever is signed in shows as initials on it, and in full in
    its label, its title and the panel); docked in the board's band on a phone it keeps its words. The board link on a
    tool's screen is a 38 px round icon (managers only since the same day). Every page with the floating button gets
    64 px of room at its bottom (`#sos-fb-room`), so a page's own last buttons can be scrolled clear of the corners.
  - *#290, "every chelsea tool window the anetix logo pops up on the tab header, it should be more discreetly
    anetix".* A company with no icon of its own showed the Anetix mark in its color on every tab. Now
    `/api/c/:slug/icon` and `/icon.png` answer its plain mark (`src/brandmark.js`): its initials on its brand color
    (navy without one), an SVG for the tab and a PNG drawn without any dependency for iOS. Settings has Your logo: a
    manager uploads a PNG or JPEG of up to 512 KB (`POST /api/c/:slug/brand/icon`; checked by its first bytes, never
    an SVG, scanned by `scan.check` before it is kept), which a rebuilt brand guide never replaces, and Take it off
    goes back to the website's icon or the initials (`/brand/icon/clear`; both on the record). The icon routes answer
    with `nosniff` and a sandboxing policy. The company's own pages (Settings, People, Connections, Diagrams, the
    enrollment page) name its icon in their HTML and drop "Anetix · " from their title (`server.js companyPage`),
    and the login page leads with the company's name when it knows it (`/login/mode` answers `name`), with Anetix
    small at the bottom.
  - *#287, "the ability to point at something when giving feedback to Anetix".* Point at it and Add a photo were on
    a tool's screens only. Now they are on the pages that send to Anetix too (the board, Settings, /admin): the
    element is kept on the request (`arrival.cleanElement`) and a photo follows the company's photo switch and the
    data wall like any other. The Requests tab shows "Pointing at: <the words>" with where it was, and "See the
    photo". The admin MCP's `list_requests_to_anetix` passes what was pointed at in words and `has_photo`, never the
    element's markup or the photo.
  - *#288, "I want the ability to work on multiple new tool drafts at the same time".* `intake.create` used to reopen
    the company's one unfinished request (the launch audit 1.5: every tap on New tool started an empty one). Now a
    tap starts a new draft beside the others, each its own card on the board, and only a draft that is still blank
    (nothing answered, not named) is opened again (`intake.blankFor`). A connected app (the admin MCP) still keeps to
    one: it carries on with Anetix's own unfinished request and refuses or takes over the plant's as before.
  - *Tests.* `scripts/e2e/smallfixes.js` (24: the initials icon and its PNG, the headers, the upload refused as an
    SVG, over 512 KB and as a fake PNG, a PNG and a JPEG taken, Settings and the board's icon address, Take it off,
    the record, the company pages' HTML, the login page's name, a pointed request to Anetix with a photo on the
    Requests tab and in the MCP's words, and in a browser the round button with room below it, the logo card, Point
    at it on a settings page), `scripts/e2e/phase1.js` (several drafts, a blank one opened again),
    `scripts/e2e/board-browser.js` (the round icons and the room on a tool's screen).
- **Archiving a tool, and deleting one for good (2026-10-29)**
  - *Why.* Taylor's request #286, "I want the ability to delete a module from the admin view of a company"; Brendan's
    decision: "it should be archive to where it doesn't show up on the main screen just under settings. Then from the
    admin side we can actually delete it."
  - *Archive (a manager).* The tool's Settings popout on the board has Archive this tool
    (`POST /api/c/:slug/modules/:name/archive`, a fresh PIN for a signed-in name). `platform.modules.archived_at`
    takes it off the board (the band, its cards, its screens and runs), and its screens, preview and test floor
    answer 410, "This tool is archived" (a page in words, JSON for a call; `registry.attach` asks `archive.isArchived`,
    a set kept in memory). Refused while one of its builds is open. When another live tool reads it (`ctx.peer` in
    its routes.js), the manager is told which and asked again (`confirm: true`); the reader keeps reading its data.
    Settings lists Archived tools with Bring it back (`/unarchive`). Nothing is lost by archiving.
  - *Delete for good (Anetix).* The admin's company card marks an archived tool and offers Delete for good
    (`POST /api/admin/companies/:slug/modules/:name/delete`): the tool's name typed and the admin's step
    (`auth.checkAdminCode`). Only an archived tool, and never the library's own copy in the company it seeds (the
    demo company gets the library's tools again at every start, `registry.loadAll`). Its live, preview and test
    floor schemas and every snapshot are dropped, its versions, docs, batches, connections, uploads, allowances,
    reviews, diagrams, data requests, ERP cache, print jobs, sample fills and retired checks go
    (`archive.GONE_WITH_IT`), its mounts and processes are let go, and its open requests are closed with "The tool was
    deleted." Its requests, builds, AI spend, library copies and the record stay. The name is free again after.
  - *Not changed.* A paying site's fee counts the tools live on its floor (`src/modprice.js`); an archived tool still
    counts until it is deleted. The tool library, Ask Anetix and the MCPs still see an archived tool.
  - *Tests.* `scripts/e2e/archive.js` (33), in `run-all.sh`.
- **Sign in with Google or Microsoft (2026-10-29)**
  - *Why.* Brendan's request #301, "We need to have auth login, so people can login from their google or Microsoft
    accounts or other, that will be much easier for most people"; his decision: for managers, admins and a demo's
    sign-up, as a second route beside the email, password and second factor; never the floor.
  - *Connected, never matched by email.* `src/oidc.js`. A named account with a full session presses Connect Google
    or Connect Microsoft (Settings, Your sign-in; the Accounts tab of /admin, `public/assets/identities.js`) and signs
    in there once; the provider's own id (Google's `sub`, Microsoft's tenant and object id) is kept on the account in
    `platform.account_identities` (it travels with the account in a backup). From then on Sign in with Google or
    Microsoft on the account form is the whole sign-in, second factor included. An email claim is never used to find
    an account: it is not always one the person proved (a Microsoft tenant's admin sets it), and matching on it is how
    accounts elsewhere were taken over. One provider account connects to one Anetix account.
  - *The flow.* Authorization code with PKCE (S256); state, nonce and verifier in one signed HttpOnly cookie on
    `/login/oidc` for ten minutes. The ID token comes straight from the token endpoint over TLS with the client secret,
    so its signature is not checked (OpenID Connect Core 3.1.3.7); its issuer (Microsoft: the token's own tenant, and
    the one tenant or no personal accounts when `SOS_MS_TENANT` says so), audience (and `azp` with several), expiry,
    issue time and nonce are. Failures count against the per-address sign-in limit. A manager lands on the page they
    were sent from inside their company, else their board; an admin on the page asked for, else /admin. The login
    page says what happened in words (`?oidc=`: not connected yet and how to, cancelled, took too long, switched off).
  - *Switching it on.* Off until a provider's client id and secret are set and `SOS_PUBLIC_URL` names the instance:
    `SOS_GOOGLE_CLIENT_ID`, `SOS_GOOGLE_CLIENT_SECRET`; `SOS_MS_CLIENT_ID`, `SOS_MS_CLIENT_SECRET`, `SOS_MS_TENANT`
    (`common` by default). The redirect addresses to register: `https://app.anetix.ai/login/oidc/google/callback` and
    `https://app.anetix.ai/login/oidc/microsoft/callback`. `SOS_OIDC_STUB` points both at a stand-in for the tests and
    is refused on a hosted instance.
  - *Not yet.* A demo's sign-up on anetix.ai with Google or Microsoft is the www service's (its own repo); the account
    it makes would carry the identity the same way.
  - *Tests.* `scripts/e2e/oidc.js` (28, against a stand-in for both providers it serves itself), in `run-all.sh`.
- **The sign-in map: how everyone signs in, before a way in is taken away (2026-10-29)**
  - *Why.* Brendan, deciding to take the shared passwords out: "I don't think we have ever actually used floor or
    managers passwords other than for testing, but I also want to have mapped out how everyone is logging in so I do
    not bulldoze something I should not". Nothing showed it in one place: the admin card says what is set up, the
    sign-in log covers named accounts only, and a shared password logged no sign-in at all.
  - *What.* `src/signins.js` `map({ days })`, served as the admin MCP tool `sign_in_map` (read only). For every company:
    the floor's sign-in (a floor PIN, a floor password from before PINs, the old instance-wide one, or none), whether
    its plant network is set, whether it has a shared manager password, and each manager account with its ways in
    (authenticator app, passkeys, Google or Microsoft) and its last sign-in; then Anetix's admin accounts, and whether
    the instance-wide password variables are set. Beside each, what was used in the window: sign-ins by way from the
    sign-in log for accounts; for the floor, the record lines a floor session wrote (and how many carried a person's
    name); for a shared manager password, the record lines a manager session with no account wrote, counted from
    2026-10-15 at the earliest (the record names the account only since then). People with their own PIN, per company.
  - *Shared sign-ins are logged from now on.* `auth.loginHandler` writes `shared_sign_in` to the sign-in log for a floor
    or a shared manager password sign-in, with the company, the role and which way (`sessionFor` says it: floor PIN,
    floor password, shared manager password, the instance-wide ones). The map counts them per company.
  - *Never.* A hash, a PIN, a code, a network or an address anyone signed in from.
  - *Tests.* `scripts/e2e/mcp.js` (the tool on the address, the legacy demo's floor and shared manager password used and
    logged, the admin accounts, no address or hash in the answer), `scripts/test-mcp.js` (nineteen tools).

- **The value stream map, M1: the Map beside Kaizen (2026-11-01, VSM dev copy)**
  - *What.* A second view for managers and admins, `/c/<slug>/map` (`public/map.html`, `src/vsm.js`, design
    `docs/VSM.md`): one map per product family, drawn the standard way (production control's steps on top, material
    left to right below, inventory triangles, data boxes, the timeline ladder), every box colored by where its record
    lives (`anetix`, `next`, `other`, `paper`, `none`). Layers: Systems, Agents (concept: which agent would watch a step
    and what they would say to each other, nothing runs), Kaizen (numbered bursts on boxes), Timeline. A box's detail:
    what happens, what is and is not recorded, the tools on it with their use, the evidence and a quote. The board's
    band has Kaizen and Map tabs (managers and admins; the floor never sees the map).
  - *Decisions (Brendan, 2026-11-01).* Managers land on Kaizen, the Map is a tab. Coverage is two numbers: stages with
    an Anetix tool live, and stages whose tool is in daily use (`module_use`: the company's floor and manager sessions
    opening a tool's screens and changing something; admin sessions never count; daily = changed on 5 of the last 14
    days, since Chelsea's first floor works four days). In M1 a manager answers the review questions and makes small
    edits (a box's name, who, record, tools, data box rows, notes, its place by dragging); boxes and flows are added by
    an admin's import (format `anetix-map-1`) until the mapping walk (M2). Managers and admins see it.
  - *Tables.* `vsm_stages`, `vsm_maps`, `vsm_nodes`, `vsm_edges`, `vsm_questions`, `vsm_kaizen`, `module_use`: all in
    the backup and gone with the company. Flows are stored as two boxes and the sides they leave and enter; the page
    routes them, so a dragged box keeps its flows.
  - *Record.* `map_changed`, `stage_changed`, `map_question_answered`, `map_imported`. A drag alone is not recorded.
  - *Routes.* `GET /api/c/:slug/vsm`, `GET .../vsm/maps/:id`, `POST .../vsm/nodes/:id`, `POST .../vsm/stages/:id`,
    `POST .../vsm/questions/:id/answer`, `GET .../vsm/export` (managers and admins), `POST .../vsm/import` (admins).
    Every id is checked against the company in its own WHERE as well as by the guard.
  - *Tests.* `scripts/e2e/vsm.js`.
  - *Not yet.* The mapping walk (M2), cards on the board tied to a box (M3), stage scans and live numbers (M4), agents
    (M5). The Chelsea seed file is kept out of the repo (it carries Chelsea's people and quotes).
- **The value stream map, M2: the mapping walk (2026-11-01, VSM dev copy)**
  - *What.* The agent that guides a manager, or Anetix as a service, through mapping one product family (`src/vsm-walk.js`,
    the walk panel in `public/map.html`, `docs/VSM.md` section 5). Sources first (typed or pasted words, a pdf, a photo,
    a text file or a spreadsheet as words; every file through `scan.check` before it is kept, its bytes in
    `platform.attachments` with `walk_id`). One read (the company's design model, `structured:map_extract`, metered as
    `mapping`) finds families, the customer, systems, production control in order, the material steps of each family in
    order with who, trigger, record, waits, numbers, a quote and its source, the supplier and open questions; generated
    words go through the plain-words scrub, quotes stay as said, a number nobody said is "?". Then the walk: family,
    customer and demand, systems, the last step before the customer, then step by step upstream (a guess, other steps
    from the sources, a step the sources missed, or "this is where it starts"), each step a card, then the supplier,
    production control, a review. **Draw the map** is platform code, no model: process row in flow order, production
    control right to left in its band, supplier and customer, push flows with what waits before each step, information
    flows from each step's trigger, data boxes, and a review question for every unknown, every step the manager was
    unsure of, every question of the read, and every step of the sources left out.
  - *Decisions (Brendan, 2026-11-01).* "Confirm the guess": about two screens a step (which step, then its card).
    Board and admin MCP now. The result is a draft beside the family's current map (`vsm_maps.proposed`); **Use this
    map** (board only) replaces the family's map, and the old one is kept, hidden (`replaced_at`, its key and review
    answers moved aside), never deleted. A company with no stage list gets one from the map's boxes when a map is used.
  - *The admin MCP* (`src/mcp-vsm.js`): `list_map_walks`, `get_map_walk` (read), `start_map_walk`, `add_map_source`
    (words only; files on the board), `read_map_sources` (paced with the intake's sends), `answer_map_walk` (family,
    customer, systems, the steps in flow order, supplier, production control, in one call, each part saved or refused
    on its own), `draft_map_walk`, `map_another_family`. It writes only to a walk Anetix started; a paying site's own
    walk shows only how far it got; nothing there uses a map or puts a walk away; no source's words come back.
  - *Rules kept.* Under the data wall the typed words still go to the read, a pdf or a photo is named and never sent.
    A manager reads no model and no cost (an admin does). One family per map; at most 24 steps and 6 production
    control steps. Sources are fixed once read ("Read the sources again" starts over). A read running at a restart is
    marked failed at boot, to be read again. A map import puts a drawn walk back to its review.
  - *Tables.* `vsm_walks`, `vsm_sources` (in the backup, gone with the company); new columns `vsm_maps.walk_id`,
    `proposed`, `replaced_at`, `attachments.walk_id`. The data export carries the map and the walks' sources.
  - *Record.* `map_walk_started`, `map_source_added`, `map_source_removed`, `map_walk_reading`, `map_walk_read`,
    `map_walk_answered`, `map_walk_step` (before and after of a card), `map_drafted`, `map_walk_reopened`,
    `map_walk_back_to_sources`, `map_walk_used`, `map_walk_abandoned`.
  - *Routes.* Under `/api/c/:slug/vsm/walks` (managers and admins): list, start (`from_walk` for another family),
    one walk, `words`, `file`, `sources/:sid/remove`, `read`, `answer` (`{ screen, ... }`; a screen the walk is not on
    is a 409, the frame, a card, the supplier and production control can be answered again any time while walking),
    `draft`, `reopen`, `reread`, `abandon`, `use`.
  - *Tests.* `scripts/test-vsm-walk.js` (27), `scripts/e2e/vsm-walk.js` (65), the walk's part of `scripts/e2e/mcp.js`
    and `scripts/test-mcp.js`.
  - *Not yet.* Floor answers to a box's question through its station QR code, kaizen bursts proposed from the walk and
    the future state (phase 6, with M3), a second read that adds sources to a walk under way, a walk of the whole plant
    across families at once.
- **The agent board, A1: agents from the map, watches, flags routed by the map, climbing (2026-11-02, VSM dev copy)**
  - *What.* The third view, Kaizen | Map | Agents (`public/agent-board.html` at `/c/<slug>/agent-board`, `src/vsm-agents.js`,
    design `docs/AGENTS.md`): one public board for managers and admins with #plant, #escalations, a channel per agent
    and per box with no agent, and threads. Agents are the `detail.agent_name` on the map's boxes; one can be set up
    only where an Anetix tool sits on its boxes. Setting it up drafts watches from the tool's tables (no AI); a manager
    turns each on and sets its limit. Watches (Stuck, Waiting, Level, Due, Quiet) run every `SOS_WATCH_MS` through the
    company's read-only role with every name checked against the tool's own tables, values as parameters, never free
    SQL. A watch that finds rows opens one flag with the rows by name and keeps it while they stay; when they clear it
    closes. The flag goes to the agent's channel, #plant, and the immediate parties on the map (the box before, the box
    after, the production control box with an information flow in): their agent if one is on, else that box's people.
  - *Decisions (Brendan, 2026-11-02).* Its own tab; a manager turns each watch on; a flag for an area with no agent
    goes to that box's people; climbing goes to the board's notices and also to the founders' ntfy for now, "to get a
    sense" (`SOS_AGENT_PUSH=off` backs it off), with no record value in the push; the floor does not see the board (a
    station line is an experiment for later, off by default).
  - *People.* Seen, On it, Resolved (with a line), Not a problem (with a line; mutes the watch a week), Reopen, Make
    it a request (a Kaizen card on the flag's tool, `feedback.source = 'agent_board'`, read by the proposer at once),
    replies and messages. Look becomes Act after `SOS_FLAG_RAISE_MIN` (720) unseen; Act climbs after
    `SOS_FLAG_CLIMB_MIN` (240): #escalations, a notice (`agent_flag`), a red box on the Map, the push.
  - *Rules kept.* Read only, scoped to the agent's tools; nothing writes a tool's record or moves anything toward the
    floor; watches are platform code, so they run under the data wall; no model names or costs; every change on the
    record; the board is in the backup, the data export (`agent_board`) and goes with the company.
  - *Tables.* `vsm_agents`, `vsm_watches`, `vsm_messages`, `vsm_flags`. *Record.* `agent_set_up`, `agent_changed`,
    `agent_watch_added`, `agent_watch_changed`, `agent_flag`, `agent_flag_cleared`, `agent_flag_climbed`, the people's
    `agent_flag_*` and `agent_board_message`.
  - *Routes.* `/api/c/:slug/vsm/agents` (list, set up), `/agents/:id` (on, paused, brief), `/agents/:id/tables`,
    `/agents/:id/propose`, `/agents/:id/check`, `/agents/:id/watches`, `/vsm/watches/:id`, `/vsm/board` (channels and
    the stream), `/vsm/board/threads/:id`, `/vsm/board/messages`, `/vsm/board/flags/:id/:action`. Managers and admins.
  - *Tests.* `scripts/test-vsm-agents.js` (32), `scripts/e2e/vsm-agents.js` (59) and its `runner` mode (3).
  - *Not yet (A2).* Disagree watches across two tools, the agents' own reviews and shift notes (AI, once a shift),
    answers between agents, the floor's station line, counts on the admin MCP. (All but the station line are A2, below.)
- **The agent board, A2: shift reviews, answers between agents, Disagree watches, briefs, draft request cards (2026-11-02, VSM dev copy)**
  - *What.* The agents' own turn (`src/vsm-review.js`). A manager turns an agent's reviews on; then once a shift (the
    company's `shift_times` in its own time zone, `platform.vsm_agent_settings`, 15:00 New York until changed; the watch
    runner's tick starts them, at most three hours late, never catching up an older one) and early when an Act flag is
    sent to it (at most once an hour, `SOS_AGENT_EARLY_MIN`), the agent gets a few model calls (`SOS_AGENT_REVIEW_STEPS`,
    6) with Ask Anetix's `describe_tool`, `summarize_records` and `read_records`, held to its own tools (`ctx.only` in
    `assist-tools.toolFor`, so another tool is not there for it even by name), and ends with one `post_review`: a note,
    up to two flags its watches missed (the ids it names are read back through the read role, the labels are the
    records', and a flag naming no real row is left out), clears of its own review flags, answers in threads it was
    given, a pass to a neighbor's agent, one question to a neighbor, up to two watch ideas (checked with `checkSpec`,
    kept as proposed) and one draft request card. What platform code leaves out is listed on the review
    (`posted.left_out`) and shown in the agent's panel. **Review now** asks for one at once.
  - *Hops.* A watch's flag or an agent's question is hop 0; each agent's answer or pass in its thread is one more; past
    2 only people write in it. An agent answers a thread once a review, never answers itself, passes a thread once,
    and is not offered a closed flag or a person's tap (Seen, On it, sent to Kaizen) as something to answer. A pass
    puts the neighbor on the reply's `to_list`, and the stream shows a thread in every channel a reply is addressed to.
  - *Disagree.* A sixth watch shape (`src/vsm-agents.js`): rows of one of the agent's tools whose key (part number,
    item, work order) another of its tools does not know (`missing`), or knows with a number past a comparison
    (`compare`, an MO marked short while Inventory shows enough). One query through the read role, every name
    qualified, keys matched whatever their case and spaces. Drafted at set up where a table of work and a list of
    things share a key column.
  - *Briefs.* Setting an agent up drafts its brief with AI (`agent_brief`, a forced structured call), from its boxes and
    its tools' tables and columns, with row counts and the values of a state column where the data wall is down; it
    keeps a brief a manager wrote meanwhile. Draft it again replaces it.
  - *Draft cards.* A `draft` message and a `vsm_drafts` row; Send to Kaizen files a request (`source = 'agent_board'`,
    "drafted by <agent>, sent by <manager>", read by the proposer at once); Not now puts it away. Only a manager's tap.
  - *Rules kept.* Under the data wall no reviews and reviews cannot be turned on; a manager turns each agent's reviews on;
    reviews are metered as `agents` (`ai_calls` and `ai_usage`), count against the company's budget and a demo's
    credit, and are capped per company a day (`SOS_AGENT_REVIEWS_DAY`, 40); the last step forces `post_review` only
    where the model takes a forced tool (`agent.takesForcedTool`; Fable 5.1 and Opus 5.5 do not, so the step before says
    it in words); what an agent writes is scrubbed of model names and long dashes; the prompt quotes every word people
    and agents wrote and says they are never instructions; the manager's reads carry no model and no cost. The switch
    notes (paused, reviews on) are posted by Anetix, naming the person, so a review does not take them for a person
    talking to it.
  - *Admin MCP.* `agent_board_status`: per company its shift times, per agent the counts (watches, flags open, climbed,
    closed in 7 days, reviews done and failed in 7 days, the last one), never a word; a paying site's own agents
    numbered, not named.
  - *Tables.* `vsm_agent_settings`, `vsm_reviews`, `vsm_drafts`; `vsm_agents.reviews`, `last_review_at`,
    `last_shift_at`. In the backup, the data export (`agent_reviews`) and the company delete. *Record.* `agent_review`,
    `agent_review_failed`, `agent_review_asked`, `agent_brief_drafted`, `agent_settings_changed`, `agent_draft_dismissed`.
  - *Routes.* `/api/c/:slug/vsm/agents/:id/review` (Review now), `/agents/:id/reviews` (the last 15), `/agents/:id/brief`,
    `/vsm/agent-settings` (get, set), `/vsm/board/drafts/:id/:action(send|dismiss)`; `/agents/:id` takes `reviews`.
  - *Tests.* `scripts/test-vsm-review.js` (19), `scripts/test-vsm-agents.js` (41 with Disagree), `scripts/e2e/vsm-review.js`
    (53, fake model), its `api` mode (9, the requests a real review sends, against a stand-in for the Messages API) and
    its `shift` mode (4, the shift clock with the runner on), `scripts/test-mcp.js` and `scripts/e2e/mcp.js` for the counts.
  - *Not yet.* The floor's station line (decision 6, an experiment, off by default); drafts across tools approved on the
    receiving tool's screen and the assembly agents from stage events (A3, below).
- **The agent board, A3, and stage events (VSM M4): drafts across tools made on the tool's own screen, live numbers on the map (2026-11-02, VSM dev copy)**
  - *Decisions (Brendan, 2026-11-02, AGENTS.md 7 to 10).* The tool takes a draft (a service lent to tools; each tool opts
    in through one normal Kaizen change); an agent drafts into its own tools and its neighbors' on the map; managers
    always act on a draft, the floor only on a tool a manager opened (off by default); stage events built now, the
    platform side, Chelsea's tools opting in later.
  - *Drafts across tools* (`src/vsm-drafts.js`). A tool declares in module.json `"drafts"` the kinds it takes and their
    fields (text, integer, number, date, boolean; choices, limits); the module gate checks it (`layout-drafts`). A
    review's `records` output is checked against the declaration and the agent's draftable tools (its own and the
    tools on its near boxes, `vsm-agents.nearBoxes`), posted as a `record` message addressed to the receiving box's
    agent or people, and kept in `vsm_record_drafts` (waiting, taking, taken, declined, withdrawn, expired). The tool
    reaches it on `ctx.drafts`: `list(req)`, `claim(req, id)` (held two minutes; a lapsed claim returns to waiting),
    `finish(req, id, { ref })`, `decline(req, id, { note })`; only the floor's version of a tool acts. The board shows
    each draft's state with Open (the tool's screen) and Withdraw; #plant's panel lists the tools that take drafts with
    the floor switch (`vsm_tool_settings`). A draft nobody makes expires after `SOS_DRAFT_DAYS`; at most
    `SOS_DRAFTS_WAITING` wait for a tool. The agent reads what became of its last drafts, a decline's words too.
  - *Who acts* (`src/runner.js`). A tool's own process is told the visitor's role in headers, and its code could say
    anything back; so each proxied request carries `x-sos-ticket`, the child hands it back with `drafts.*` and
    `vsm.event`, and the platform reads the person from its own record of the request (same company, tool and lane,
    while the request lasts). A tool kept in the platform's process gets the platform's own request.
  - *Stage events* (`src/vsm-stages.js`). `ctx.vsm.event(req, { step, ref, kind, qty })`, kind start, wait, finish or
    scrap, kept in `vsm_stage_events` (only the floor's version of a tool; `SOS_STAGE_EVENTS_DAY` a company a day). A
    box's editor on the Map ties it to steps the tools have reported (`detail.steps`, also through the map's import and
    export); `mapView` returns `live`: per box cycle time, wait in line, WIP and the oldest open, finished, scrapped,
    first-pass yield, finished a day; the waits between boxes on the material flow; the lead time to the last box
    (`SOS_STAGE_WINDOW_DAYS`, 7). The data box shows them beside the numbers people said, the ladder uses them, the
    selected box lists them.
  - *Agents on steps.* A box tied to steps can have an agent with no tool of its own (`vsm_agents.steps`); set up, it
    drafts a stage watch a step ("work open too long"); the stage watch is work open at a step past some hours, or more
    open than a number; its review gets `stage_numbers` (the numbers, what is open longest, the last events).
  - *The reference tool.* Paper Airplane Line (repo seed) reports each station (a traveler waits at a station when it
    arrives, finishes there, or is scrapped at the test) and takes `material_request` drafts on its Stockroom screen
    (Make it runs its own request logic; Decline asks why). MODULE-CONTRACT.md has "Drafts from agents" and "Stage
    events" so a build can opt a tool in.
  - *Rules kept.* An agent never writes a tool's record: a person makes the draft on the tool's own screen; the floor
    sees no draft unless a manager opened that tool; no model or cost in what a company reads; the admin MCP's
    `agent_board_status` counts drafts and stage events, never their words; every decision on the record
    (`agent_record_drafted`, `agent_draft_taken`, `agent_draft_declined`, `agent_draft_withdrawn`, `agent_drafts_floor`);
    the drafts, the switch and the events are in the backup, the data export (`agent_record_drafts`, `stage_events`) and
    go with the company.
  - *Tests.* `scripts/test-vsm-a3.js` (29), `scripts/e2e/vsm-a3.js` (42, with tools in their own process and again
    inline), the module gate's suite, `scripts/test-mcp.js` and `scripts/e2e/mcp.js` for the counts.
  - *Not yet.* Chelsea's own tools opting in (each a Kaizen change: a drafts tray on MO Board, stage events on its
    stages); scanners or tablets for stage scans (VSM decision 5); the floor's station line (decision 6, built next:
    "The floor's side of the map" below).

- **The value stream map, M3: the Map and the Kaizen board joined, and the future state (2026-11-02, VSM dev copy)**
  - *Why.* The last unbuilt piece of `docs/VSM.md` (section 10, M3): a request sits on a box of the map, every box can
    start a request, a kaizen burst becomes a request in one tap, and the walk's last phase, the future state. Decision 9
    (Brendan, 2026-11-02): the agent drafts the future state and the manager keeps it.
  - *A request on a box* (`src/vsm-kaizen.js`). `feedback.map_key` and `feedback.node_key` tie a request to a box by keys
    (a key survives an import and a walk's "Use this map", an id does not; the agent board ties boxes the same way). The
    board's payload has `boxes` (label, map); a card shows "On the map: <box>" (a tap filters the board to that box,
    `?box=<map>/<box>`, as the tool filter does) and Show on map (`map?mapkey=&box=`). A request an agent drafted and a
    manager sent from the agent board sits on the flag's box when it is one box. The box's panel on the Map lists its
    cards and has Ask for something here.
  - *Three ways from the map.* A change to one of the box's live tools (`source` 'map', the proposer reads it on arrival
    as any request); a plant request (`feedback.kind` 'plant', no tool: work on the floor itself, never a request to
    Anetix, never read by AI; the board's card has Working on it, Done, Not doing this and Make it a new tool); a new
    tool request with round 1 pre-filled from the box (`prefillFromBox`: the request's words and the box's own as the
    purpose, the floor for a process box and the office for production control, how it is kept today from where its
    record lives, the plant's stages when the box carries two or more, the other system it works with), opened on the
    board in its popout (`?intake=`). The same three from a burst (`/vsm/kaizen/:id/file`), which then shows its
    request's number and where it is; a burst can be put away and brought back.
  - *The future state.* Draft the future state (`/vsm/maps/:id/future`): one model call (the design model, metered as
    `mapping`) reads the current map (boxes, who, records, tools, data boxes, what happens, quotes, flows, waits, open
    questions, the kaizen already there, today's live numbers unless the data wall is up) and returns a summary, up to
    eight bursts, flow changes and record changes. `checkFuture` holds each to the map: a burst's box must be there and
    its evidence must be on it (a quote in the box's own words, a ? in its data box, a word-of-mouth flow, a wait before
    it, no record or paper); a flow joins boxes that are there; what fails is listed as left out. `drawFuture` copies the
    boxes in place, changes the flows and records, and numbers the bursts (`source` 'agent', with `evidence` and
    `becomes`). The future map (`state` 'future', `parent_key`) sits beside the current one as a Current state / Future
    state tab with a bar: the summary, what was left out, Keep this future state, Draft it again (the earlier draft is
    kept hidden). A burst on it files on the current map's same box. The draft runs in the background; the page shows the
    agent drafting and opens the draft when it is there. Agents, the walk and the live numbers never read a future map.
  - *Rules kept.* Managers and admins only, every route under `/api/c/:slug/vsm` with ids checked against the company;
    nothing moves toward the floor (a change waits for its proposal and the approval; a new tool for its design and
    confirm); no model or cost on the map; on the record (`kaizen_filed`, `kaizen_put_away`, `kaizen_brought_back`,
    `intake_started_from_map`, `plant_request_moved`, `map_future_asked`, `map_future_drafted`, `map_future_kept`); the
    map file carries the future state, its parent and each burst's evidence; the admin MCP's `agent_board_status` counts
    the map's requests.
  - *Tests.* `scripts/test-vsm-m3.js` (26), `scripts/e2e/vsm-m3.js` (54), `scripts/e2e/vsm-m3-browser.js` (23).
  - *Not yet.* A future state with boxes of its own (a supermarket, a merged cell) and its flows edited by hand; bursts
    on a flow rather than a box; the gate (a burst on Chelsea's map becomes a change live on Chelsea's floor).
- **The floor's side of the map: who each screen is for, a box's station screen, the agent's line on it (2026-11-02, VSM dev copy)**
  - *Why.* Agent board decision 6 (Brendan, 2026-11-02): the floor sees a flag only as an experiment, a switch per agent,
    off by default, one line on that box's station screen; read only. Tools built before 2026-10-29 say nothing of who
    each screen is for, so that comes first.
  - *Screen tags* (`src/vsm-floor.js`, `platform.screen_tags`). A manager says who a screen is for (The floor, The office,
    Not said) on the QR codes tab of a tool's Screens; kept by route, it wins over the tool's own module.json word and
    needs no build. The board's screens and the QR codes read the tags (the floor's first). A build's page check still
    reads only the manifest.
  - *A box's station screen.* The box's editor on the Map picks one live screen of the box's own tools
    (`detail.screen`); an untagged screen picked there becomes the floor's.
  - *The line.* The agent board's panel for an agent has Its line on the floor (`vsm_agents.floor_line`, a note in its
    channel when switched). With it on, the feedback button on a live tool screen asks `/api/c/:slug/who/line` once a
    minute and draws the agent's most urgent open flag (climbed, then Act, then oldest) as one line at the bottom of the
    screen, red for Act, amber for Look; a tap opens the words and how long it has been open. Only on a box's station
    screen, only live (never a preview, the test floor or the board's screen tiles), nothing to press. Cut to 160
    characters, scrubbed of model names and long dashes. A floor device being shown a flag counts once each ten minutes
    (`vsm_flags.floor_views`), shown on the agent's panel and in `agent_board_status`.
  - *Rules kept.* `/who/line` is open to any device of the company, like the rest of `/who`, and gives only what the
    board already shows a manager for agents a manager switched on; the tag route is managers only, on a path the tool
    page policy does not open; screen tags are in the backup and go with the company.
  - *Tests.* In `scripts/test-vsm-m3.js` and `scripts/e2e/vsm-m3.js` and `-browser.js` (the line on a phone).
