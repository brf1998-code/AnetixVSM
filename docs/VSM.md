# Anetix VSM: the living value stream map

*Design, rev 2, 2026-11-01. M1 (the Map) and M2 (the mapping walk) are built; section 10 has the status. The worked example is
Chelsea Clock (the canvas "Chelsea Clock Value Stream Map", 2026-11-01). Grounded in the code as of SymbioticOS
615a490; file references are to this repo.*

---

## 1. What this is

The product gets two primary views instead of one:

- **The Map.** The plant's value stream, one map per product family: every step, the material and information
  flows between them, the inventory waiting between them, and where each step's record lives (an Anetix tool,
  another system, paper or word of mouth, or nothing). Boxes backed by an Anetix tool fill their own numbers from
  what the floor does. Boxes that are not show "?" and say what would fill them.
- **The Kaizen board.** Today's improvement board: request, proposal, review, build, preview, live. Every card sits
  on a box of the map, and every box can start a card.

The map is not drawn by hand. **The mapping walk**, an agent-led intake, reads what the plant already has (call
notes, walk-through transcripts, documents, exports, photos of whiteboards and lists), drafts the map, marks every
guess, and walks a manager through the plant one step and one question at a time until every process and
information flow the map needs is found. The floor confirms the boxes that are theirs.

Later, each tool gets an **agent** that watches its own data and posts to the agents of its neighbors on the map.
Agents draft and flag. A person approves anything that changes a record. The manager gate stays structural.

The figure the map produces: **plant coverage**, the share of stages with a record in Anetix, beside the count of
stages with no record at all. Chelsea today, by the first-pass map: 4 of 20 in Anetix, 6 in another system, 4 on
paper or word of mouth, 6 with nothing.

## 2. Why a copy, and what has to change underneath

The current code was built around one view and one unit, the tool. From the code review:

1. **Everything is keyed by (company, module).** Feedback, connections, diagrams, agent docs, allowances, the build
   pipeline, `target_file`. A step owned by no tool (Dorothy's dispatch list, Fishbowl's order entry, the test rack)
   has nowhere to live. A request with no module falls into Requests to Anetix.
2. **The board assumes it is the only view.** One payload polled every 4 seconds, no router, the assistant's scopes
   are help, tool or company.
3. **Tools cannot talk to each other.** `ctx.peer(name)` is a read-only look at a sibling's live tables
   (`registry.js:206`), the gate refuses another tool's schema (`modulegate.js:170`), and who-reads-whom is found by
   a regex over `routes.js` (`archive.js:57`). No messages, no calls, no writes, by design.
4. **Nothing records time at a step.** The only VSM-like numbers today are the KPIs module's WIP by station and lead
   time on the paper airplane line.
5. **Diagrams are per tool and model-drawn** (Mermaid text per module version). No plant-wide drawing, no VSM icons.

So the rebuild adds a company-level layer the tools hang off, rather than another tool.

## 3. VSM practice the product follows

The map should be one a lean practitioner recognizes, so the product holds to the standard method (Rother and
Shook, *Learning to See*):

- **One product family per map.** A family is products that share most of their steps. The walk asks for families
  first and maps one at a time. Chelsea: Mechanical (12E movement) and Quartz B2B.
- **Current state, then future state, then the plan.** The future state's kaizen bursts become the plan, and the
  plan is the Kaizen board.
- **Walk it, door to door, starting at shipping and moving upstream.** Starting from the customer keeps the map
  tied to what the customer pulls.
- **Information flow on top, material flow below, the timeline ladder at the bottom.** Production control sits in
  the middle of the top. Electronic, manual and word-of-mouth flows are drawn differently.
- **Data boxes per process:** cycle time, changeover, uptime, operators, shifts, available time, scrap, batch size.
  **Inventory triangles** with a count and days of demand. **Takt time** from customer demand over available time.
  **Lead time against value-add time** on the ladder.
- **Push, pull, FIFO, supermarket and kanban** are first-class flow kinds, because the future state is mostly about
  changing them.
- **One person owns the map** (the value stream manager); the floor confirms their own boxes.
- **Pencil first.** A draft with marked guesses beats a clean map that is wrong. Every value carries where it came
  from.

What the product adds to the paper method: **where each step's record lives**, the coverage figure, live numbers
from the tools, and agents.

## 4. Data model

New platform tables, scoped by company and not by module. Each goes in `backup.js PLATFORM_TABLES`, the company
delete list (`feedback.js:1262`), `OWNERS` for id routes, and the company view's scrub.

- **`vsm_maps`**: id, company, family (text), title, state (`current` or `future`), parent map (a future state
  points at its current state), demand per day, available seconds per day (takt is computed), status (`draft`,
  `in review`, `confirmed`), owner (an account), timestamps.
- **`vsm_nodes`**: id, map, kind (`process`, `control`, `supplier`, `customer`, `outside`, `store`), label, who
  (people ids and free names), stage refs (the customer's own numbering, e.g. Arthur's 01 to 20), **record kind**
  (`anetix`, `other`, `paper`, `none`), record system (free text, e.g. Fishbowl), **module** (nullable, the Anetix
  tool that holds the record) and screen route (nullable, ties a box to a station QR), layout (x, y, row),
  **data** (JSONB: each field is `{value, unit, source, at, by}`, source one of `tool`, `measured`, `said`,
  `document`, `assumed`), confidence (`heard`, `seen`, `assumed`, `confirmed`), notes.
- **`vsm_edges`**: id, map, from node, to node, kind (`push`, `pull`, `fifo`, `supermarket`, `info_system`,
  `info_manual`, `info_word`, `ship`, `supply`), label, record kind, inventory (`{count, days, source}` for material
  edges), confidence.
- **`vsm_sources`**: what went into the walk: an attachment, a transcript, a document, an export, a person's answer.
  Each claim on the map points back to the source and, where there is one, the quote. This is the evidence trail
  the detail panel shows ("Bob, walk-through").
- **`vsm_questions`**: the review queue. About a node or an edge, the claim, why it is unsure, who should answer
  (a person, a role, or the manager), status (`open`, `confirmed`, `fixed`), the answer, who answered.
- **`vsm_kaizen`**: a burst on a node or edge: title, why, the evidence, status, and the board card it became
  (`feedback_id`).
- **`stage_events`** (section 7): the append-only log tools write when work starts, finishes, waits or is scrapped
  at a step.

Changes to existing tables:

- **`feedback.node_id`** (nullable). A request can sit on a map box that no tool owns, and the board shows the box.
  This removes the "no module, so Requests to Anetix" trap for plant requests.
- **`platform.events` gets a company column** (it has none today).
- **The record** gets kinds for the map: `map_source_added`, `map_drafted`, `map_question_answered`,
  `map_confirmed`, `map_changed`, `kaizen_filed`. Insert-only, like the rest of the record.

Coverage, takt, lead time and the ladder are computed from these rows by platform code, not by a model, so they
work behind the data wall.

## 5. The mapping walk

Built on the new-tool intake (`public/assets/intake.js`, `src/intake.js`): the same popout, one question per
screen, chips plus free text plus Attach, Back and Next, progress, every answer saved as it is given, close and come
back any time, the plain-words scrub on everything generated, and a design-style confirm at the end. Started by a
manager or an admin, never shown to the floor as a whole.

**Phase 0, Read.** The manager (or Anetix, through the admin MCP, as a service) adds sources: call recordings or
transcripts, walk-through notes, the customer's own process documents, an ERP export, photos of whiteboards, travelers
and handwritten lists. The model extracts candidate steps, people, systems, flows, numbers and quotes, each tied to
its source with a confidence. For Chelsea this is the work done by hand on 2026-11-01 from the first walk-through,
Arthur's architecture and the emails.

**Phase 1, Frame.** What the plant makes and how orders arrive; the families the extraction suggests, and which to
map first; the customer's demand and how often the plant ships; the systems in use (Shopify, Fishbowl, QuickBooks,
HubSpot), named once so every later question can offer them as chips.

**Phase 2, Walk upstream from shipping.** One step at a time: "What happens right before *Pack and ship*?", with
the extraction's best guess offered first ("Is it *Quality control*?") and Skip, Not sure and Add a step beside it.
Per step, a short fixed set: who does it, where, what tells them to start (a system, a list, someone asking), where
its record lives (the company's systems, paper, nothing, or an Anetix tool), what waits before it, and any number
anyone knows. Built for a phone or a tablet, so the manager can do it walking the floor, with a photo per step.

**Phase 3, Information flow.** For each step, how it learns what to do; then production control end to end: order,
MO, priority, dispatch. Word-of-mouth flows are asked about by name ("Does Shannon tell Dorothy in person, by
email, or in a system?"), because they are the ones that disappear.

**Phase 4, Numbers.** The data boxes and the triangles. Anything nobody knows stays "?" with what would fill it
("a scan at start and finish"). Nothing is estimated by the model.

**Phase 5, Draft and review.** The map draws itself. Every assumed value becomes a review question, routed to the
person who owns that box: the manager on the board, or a floor person through their station's QR code, which can
ask one question about their own step ("Is this right?" with Yes, No and a photo). Floor answers come back as
`said`, never `confirmed`, until the manager accepts them.

**Phase 6, Future state and kaizen.** The model proposes kaizen bursts, each tied to evidence (a quote, a "?", a
word-of-mouth flow, a long wait), and a future-state draft. The manager accepts a burst and it becomes either a board
request on that box or a **new-tool intake pre-filled from the box** (round 1's who, devices, today, stages and
works-with answers come straight from the node). This is the bridge from the map to Kaizen.

Stopping and cost: the same shape as the intake. An "enough" check after each phase, a cap on generated questions
per session, the design model for extraction and drafting, the short-text model for wording, metered as `mapping`.
Under the data wall the walk still runs on what people say and upload (typed words are shared by rule); only reads
of the tools' records are refused.

## 6. The two views

**Map** (`/c/<slug>/map`, managers and admins):

- Family switcher, current or future state, and layers: Systems (each box colored by where its record lives),
  Agents, Kaizen, Timeline.
- Click a box: who, what happens, what is recorded and what is not, the Anetix tool and its screens, live numbers,
  open board cards on the box, the evidence and its quote, and Suggest a correction (a review question).
- Coverage tiles across all families; the "?" count; the open review questions.
- Its own renderer from the rows, not Mermaid (which has no triangles, push arrows or ladder): an automatic layout
  in VSM bands (suppliers left, customer right, control band on top, process row, ladder), with manual drag saved to
  the node's layout.
- Later, a read-only wall mode for a TV on the floor.

**Kaizen** (today's board): each card shows its box, "Show on map" jumps there, and the board filters by box as it
filters by tool today.

The top band gets two tabs, Map and Kaizen. The floor sees neither; it sees its station screens, as today.

## 7. Live numbers: stage events

Tools report work at a step through a new service lent to module code, `ctx.vsm.event({step, ref, kind, qty})`,
kind one of `start`, `finish`, `wait`, `scrap`. It writes `stage_events`, scoped to the company, tied to the tool and
its map node. The platform computes cycle time, wait between steps, WIP, first-pass yield and lead time from the
events, and the map's data boxes and ladder fill themselves.

This is the "barcode gun at every stage" Arthur described on the first walk-through, and the station QR codes from
the 10/29 floor round are the natural trigger: scan the station, scan or tap the MO, done. Every tool that adds a
stage screen gets the event call written in by the builder, the same way the builder adds a page's floor or office
tag today.

The service has to be lent in both `registry.moduleServices` and `runner-child.js services()`, and stays
server-side, so the page CSP does not change.

## 8. Agents, in three steps

*Superseded 2026-11-02 by `docs/AGENTS.md` (the agent board: areas from the map, rule watches, shift reviews, one
public board with routing and climbing along the map). Kept below as the first sketch.*

Honest about what exists: today nothing in a tool can tell another tool anything.

1. **Watchers (no AI).** Platform rules over `stage_events` and the tools' own tables: a kit is complete, a job has
   sat at a step longer than its usual time, a part is below its level. They post to a new `vsm_messages` table
   (from a node, to a node or a person, the words, the refs, read or acted on). Messages show in the map's agent
   layer and as a notice on the board. This also gives the map its "watched" count.
2. **Tool agents (AI judgment).** Each tool's agent is a standing judgment step (`ctx.ai.judge`, already built, with
   its limits and metering) run on a schedule or an event. It reads its own tables and its neighbors' through the
   existing read-only `ctx.peer`, and posts messages: a lowest-level shortage, a batch across open MOs, a setup that
   several MOs share. Refused when the company is walled off, as judge calls are today.
3. **Drafts across tools.** A message can carry a draft for the receiving tool (a draft MO, a draft PO request)
   that a person approves on that tool's own screen. Never a direct write into another tool.

The Chelsea examples on the canvas (Bruce's lowest-level shortage, Arthur's bushings and the Mori on Fridays, Bob's
four wheels off one blank) are step 2 messages built on tools Chelsea already has.

## 9. Chelsea as the first map

The dev instance holds a full snapshot of Chelsea (tools, versions, records, board history). The first map is
seeded from the 2026-11-01 canvas as rows: both families, the 20 stages, the review questions, the kaizen bursts,
with nodes linked to Chelsea's real tools (`mo-board`, `manufacturing-order-board`, `bom`,
`inventory-management-system`, `inventory-request`). Then the walk is run on the same sources to see how close it
gets to the hand-drawn map. That comparison is the walk's first test.

## 10. Build order in this copy

Each step has a gate, as in the roadmap.

| Step | What | Gate |
|---|---|---|
| M0 | Fork, dev instance, Chelsea snapshot | Chelsea's tools open on the dev instance |
| M1 | Tables, Chelsea's map seeded, the Map view (read only, layers, detail, coverage) | Brendan or Taylor walks Zoe through Chelsea's map on the dev instance |
| M2 | The mapping walk v1 (read, frame, walk, draft, review) | Run on Chelsea's sources, it finds the hand map's boxes; Taylor runs it for a second plant without help |

Status: M1 live 2026-11-01 (commit 9ab59bf). M2 built 2026-11-01 (`src/vsm-walk.js`, `src/mcp-vsm.js`, the walk panel in
`public/map.html`; docs/FEATURES.md has the bullet): Brendan chose "confirm the guess" step cards, the board and the
admin MCP both, and a draft beside the current map with "Use this map". Phase 4 (numbers) is folded into each step's
card; phase 6 (future state and kaizen) waits for M3. The gate is a real-model run on Chelsea's sources on the dev
instance, compared with the hand map.
| M3 | Map and Kaizen joined (`feedback.node_id`, bursts to requests, intake pre-filled from a box) | A burst on Chelsea's map becomes a change live on Chelsea's floor |
| M4 | Stage events and live numbers | One Chelsea step scanned for a week; its box and ladder show real numbers |

Status: M4's platform side built 2026-11-02 with the agent board's A3 (`src/vsm-stages.js`: `ctx.vsm.event`, a box's
steps in its editor, live numbers on the data boxes and the ladder, stage watches; the Paper Airplane Line reports its
stations). The gate waits for a Chelsea tool that reports its stages, and for decision 5 (scanners or tablets).

| M5 | Watchers, then tool agents | A tool agent's message is acted on by a person at Chelsea |
| M6 | Decide: merge back into SymbioticOS or replace it | Before a second customer's production data goes on the copy (the 2026-09-17 tenancy rule) |

## 11. Carry-overs and traps

- **Plain words.** "Integration", "sync", "query" and "database" are scrubbed from generated manager text
  (`plainwords.js:11`). Map labels use "connected to", "kept in", "records".
- **HELP.md** changes in the same push as any board or map change (hard rule).
- **Floor and office tags** are missing on tools built before 2026-10-29; the map needs them to tie a box to a
  station screen, so the tagging pass runs first.
- **Pricing.** The site fee counts tools live (`modprice.js`). Map boxes are not tools and must not change the bill.
- **Trials.** Diagrams are drawn only when asked and Ask Anetix files only on live sites; a demo's map will be
  patchier until that is decided.

## 12. Decisions for Brendan

1. Which view a manager lands on: Map or Kaizen? *Answered 2026-11-01: Kaizen, with the Map as a tab.*
2. Who runs the walk: the customer's manager on their own, Anetix as a paid service through the admin MCP, or both?
   *Answered 2026-11-01: both, from M2 (the board and the admin MCP). The walk confirms the sources' guess one step
   card at a time, and its map is a draft beside the current one until a manager uses it.*
3. One map per family plus a plant overview (recommended), or one plant map with a family filter?
4. Does a stage with an Anetix tool built but not in daily use count toward coverage? *Answered 2026-11-01: two numbers,
   tool built and in daily use (worked out from the tool's own use).*
5. Stage scans: barcode guns, tablets (Arthur's preference), or both?
6. Does the floor ever see the map (a wall TV), or only their own box's question? *For now managers and admins only.*
7. Where agent messages surface: the map only, the board's notices, the person's station screen, a phone?
8. Is the map part of the site fee, a service fee, or a tier?
9. Future state: drafted by the agent from the bursts, or led by the manager with the agent assisting?
