# The data wall: the AI builds the pipeline without seeing the data

*Built 2026-09-24 from Brendan's ask: "a feature where the CI loop AI can or cannot read the company's data when it is looking at what there is to build ... it is only building the pipeline for the data to go through without ever seeing the data." Same shape as the test floor: a switch per company on the admin page. The code is `src/datawall.js` plus one line at every place a model is called; the proof is `scripts/e2e/datawall.js`. The bullet "The data wall" in CLAUDE.md says what shipped.*

## Hard rules (Brendan, 2026-09-24)

1. **A switch per company, on the admin page, set by Anetix.** "The AI reads the data too" is the default and is how every company worked before this. "Walled off from the data" is the other setting. A manager sees the state but cannot change it.
2. **Walled off means no row reaches a model.** Not from the tool's tables, not from an upload, not from an ERP answer, not from a photo or an attachment, not from the starting rows in a migration, not from a check's answer quoted back to the agent. The AI reads the tool's files (code, pages, migrations without their rows), the words people wrote, and the shape of the data (column names, headers, row counts).
3. **The words people type are outside the wall, and there is no filter on them.** Feedback, an intake's answers, a manager's adjustments, a "not right" on a campaign step: that is the request itself, and whatever the person put in it is accepted as shared with the AI. Brendan: "whatever the operator enters has to be accepted as information shared with AI, we do not want to add in a filter here." So a person who types a part number into a request has sent that part number to the AI, and the platform does not stop them.
4. **The manager's gate is untouched.** The wall changes what a model is shown, never who approves what.

## What changes, and where

Every place a model was shown company data, and what the wall does there. The choke point is `agent.atWall`, which every model call goes through (`runAgent`, `runStructured`, `runChat` all take `company`): walled, it drops image and document blocks whatever the caller sent, and with `SOS_PROMPT_LOG` set it appends every prompt as one JSON line, fake mode included, which is what the canary test reads.

| Where data reached a model | With the wall up |
|---|---|
| The proposer's context (a request on arrival, Review with AI, a system review, a campaign proposal, diagrams, the head-to-head) reads the tool's files whole | The same files with every migration's `INSERT` statements replaced by one note each (`datawall.filesForModel`); `CREATE` and `ALTER` stay, so the columns are known. The prompt carries `PROMPT_NOTE`: "build for the data's shape, never for particular values". |
| The build agent works in a folder holding the version's files | Before the agent starts, every migration that carries rows is replaced in the folder by its withheld copy (`withhold`); after the agent finishes, whatever happened, the originals go back byte for byte (`restore`). The gate refuses an edit to an existing migration anyway, so nothing is lost. The run log says "starting rows withheld from ..." and the run carries `evidence.walled`. |
| A new module's build seeds the starting rows from the manager's spreadsheet into `migrations/001.sql` | The skeleton seeds nothing and declares a `files` connection named `starting`; after the first deploy the PLATFORM loads the sheet into the tool's table through that connection (`modulebuild.afterDeploy`), the run log says the AI never saw a row, and the record has `starting_rows_loaded`. If the load fails the log says so and the tool is live with an empty list the manager can load from the connections page. |
| An intake's attachments go to the designer as image and document blocks; a sheet as sample rows | A photo or a pdf is named and withheld ("ask about what it shows in plain words if you need to"); a sheet is its headers and its row count. |
| A photo with a request goes to the proposer | Photos are off for the company: the floor's widget hides the button (`arrival.settings` answers `allow_photos: false`), the settings page's switch is greyed with the reason, and a photo that arrives anyway is refused with the words going through (`photo_note`). |
| "Point at it" sends the element's text, label and markup | Tag, id, classes, path and position only (`datawall.element`). |
| The system review takes a live snapshot of the smoke endpoints' answers | Skipped, with a line saying so; the review judges from the files and the history. |
| A failed check's answer is quoted back to the agent in a fix round, and in the campaign | Paths and types only, never values (`acceptance.match(..., hide)`: "the answer.total is a number, expected 9"). The expected values, which the agent wrote itself, are still quoted. |
| `ctx.ai.chat`, Jonah and any persona a module declares | Refused with 409 and one plain sentence the tool shows: "AI reading of the company's data is switched off for this company, so this helper cannot answer. Anetix can switch it on." A persona reads the rows by design, so it does not run. |

What stays as it was: the plain summary after a build reads the diff, which carries no rows (the from-version's migrations are restored before it is taken, and a new migration's rows are the agent's own); the cross-check reads the same diff; the campaign runs on the test floor against the data and the model sees only pass or fail per step; staging still copies the floor's rows (the agent has no database access, and the manager needs real rows to judge a preview: decided 2026-09-19, unchanged).

## What a person sees

- **Admin**, the company card, section "What the AI reads": the state in one line and one button. Walling off asks for a confirm that says what it does and does not do ("Anything already sent cannot be unsent. Jonah and other data-reading helpers will stop answering."). `POST /api/admin/companies/<slug>/data-wall { walled }`, admin only; `datawall_on` / `datawall_off` on the record and in the event log; `walled` and `ai_reads_data` on the overview.
- **Manager**, the settings page: the photos switch off and greyed with "Off while the AI is walled off from this company's data (set by Anetix)". Nothing else on the board changes; a build's run log carries the withheld line.
- **Floor**: no photo button on the feedback panel. A tool's chat says the one sentence above instead of answering.

## The proof: a canary

`scripts/e2e/datawall.js` (34 checks, fake mode, fresh database, the server started with `SOS_PROMPT_LOG`). A marker string is put into every kind of company data: a module built from an intake whose spreadsheet carries it (so its first migration seeds it, the wall being down), a row on the floor, a stock upload, a pointed-at element, a photo. Then the admin walls the company off and every flow that calls a model runs: a proposal on arrival with the element and a refused photo, a change build (the withheld migration in the run log, restored byte for byte after), a broken promise and its fix round, a system review, a campaign proposal, diagrams, an intake with a spreadsheet and its module build (no seed rows, the starting list loaded by the platform after the deploy), Jonah refused. The assertions: every flow sent prompts (the kinds are listed, so a flow that stops calling `atWall` fails the test), NO prompt carried the marker apart from the request words the test typed it into on purpose, no image or document block went out, and the element's place went without its text. Then the wall comes down and the same proposer reads the migration's rows again, photos are back and Jonah answers: that is what proves the test bites. It runs in `scripts/e2e/run-all.sh`.

The prompt log is a test tool. Leave `SOS_PROMPT_LOG` unset on the live instance: it writes every prompt, data included, to a file.

## Being honest about it

- **From now on.** The switch says nothing about calls made before it was turned on; the record says when it was turned on. A company that wants the wall from day one gets it walled before its first request.
- **The words are the words.** By decision there is no filter on what people type. A request that says "the Acme order 4471 is always late" has told the AI that. The confirm on the admin page says so.
- **The tool's files are read.** Column names, a page's labels, an agent doc, a check's expected values, reference.md: all of it goes to the model. A migration's rows are withheld, not its columns. If a company's column names are themselves sensitive, the wall does not cover them.
- **Shape, not values, is still information.** A sheet's headers and row count go through. That is the point (the AI builds for the shape), and it is what a customer should be told.
- **Staging and the test floor hold real rows.** The wall is between the data and the MODEL, not between the data and the platform; a preview shows the manager real rows, the checks run on them, and the campaign runs on a copy. None of it reaches a model.
- **What the wall cannot promise:** that a model never guesses a value; that an agent-written page never displays a row (it displays every row, that is the job); anything about a call made outside this platform.

## Cost

Nothing measurable. A withheld migration is shorter than the original; the intake sends text in place of images. Jonah and personas spend nothing while walled.

## What v1 leaves out

- A per-tool wall, or a per-table one. It is the whole company.
- A word filter on requests (refused by decision, above).
- A retention rule for photos already in the database from before the wall.
- Telling the model WHICH tables' rows were withheld beyond the note in each migration.

## Build order and status

1. `src/datawall.js`: the column, the cached switch, `filesForModel`, `withhold` / `restore`, `element`, `PROMPT_NOTE`. Done.
2. `agent.atWall` at every model call, `company` on every caller, the prompt log. Done.
3. The proposer, the review, diagrams, the campaign proposal, the head-to-head: files through `filesForModel`, the element cut, no photo, no snapshot. Done.
4. The build step's withhold and restore, the walled build prompt, value-free check findings. Done.
5. The intake's attachments and the module build's starting list through the platform. Done.
6. Photos off, Jonah refused, the admin section, the settings note, the overview. Done.
7. Unit test `scripts/test-datawall.js` (19), canary `scripts/e2e/datawall.js` (34), `run-all.sh`. Done.
