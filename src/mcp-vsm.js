// The admin MCP's mapping walk tools (milestone M2, 2026-11-01; docs/VSM.md section 5). Brendan chose "Board and admin
// MCP now": Anetix, as a service, starts a plant's mapping walk from a Claude conversation, adds the call and walk-through
// transcripts and notes, has them read, and answers the walk from what the conversation settled. The company's manager
// then reads the drawn map beside the current one and decides on the board whether to use it: that step is not here.
//
// Rules this file keeps (the same as src/mcp-intake.js):
//   - It writes through src/vsm-walk.js, the same functions the board's own routes call: one set of checks.
//   - An app writes only to a walk Anetix started through a connector (vsm_walks.via = 'anetix'). A walk the company's
//     manager started is read here for a trial, and for a paying site only when it opted in to learning; it is never
//     written to from here.
//   - Nothing here moves anything toward the floor, and nothing here replaces a map: "Use this map" stays on the board.
//     Putting a walk away stays on the board too.
//   - Reading the sources spends AI; it is counted per account per hour with the intake's sends (SOS_MCP_AI_STARTS_PER_HOUR).
//   - Files (a pdf of the plant's process document, a photo of the whiteboard) are added on the board, where they are
//     scanned. Here an app adds words: a transcript, notes, an email.
//   - What leaves: the walk's own state (what was read from the sources, what was settled), never a row from a company's
//     tool, never a file's bytes, never the words of a source (the app has them already), never a model or a secret.
const { z } = require("zod");
const { q } = require("./db");
const { byOf, plantsOwn, AI_STARTS, PER_HOUR } = require("./mcp-intake");

const say = (message) => Object.assign(new Error(message), { say: true });
const SLUG = /^[a-z0-9][a-z0-9-]{1,40}$/;
const VIA = "anetix";
const READS = ["read_map_sources"];
const slugArg = (v) => { const s = String(v || "").trim().toLowerCase(); if (!SLUG.test(s)) throw say("That is not a company's short name. list_companies gives each company's slug."); return s; };
const walk = () => require("./vsm-walk");
const boardOf = (company) => { const base = require("./mcpauth").PUBLIC; return base ? `${base}/c/${company}/map` : null; };
// The walk's own errors are written for a person; anything else stays in the log.
const words = async (fn) => { try { return await fn(); } catch (e) { if (e.say) throw e; if (e.status && e.status < 500) throw say(String(e.message)); throw e; } };

async function load(id) {
  const w = (await q("SELECT * FROM platform.vsm_walks WHERE id=$1", [Number(id)])).rows[0];
  if (!w) throw say("No mapping walk by that id. list_map_walks names them.");
  return w;
}
async function mine(id) {
  const w = await load(id);
  if (w.via !== VIA) throw say(`Walk ${w.id} was started on the board by the company, so it is not written to from here. Nothing was changed. start_map_walk starts one for Anetix.`);
  return w;
}
function nextStep(v, board) {
  const where = board ? ` (${board})` : "";
  const s = v.screen || {};
  switch (s.kind) {
    case "sources": return v.sources.length ? "Add any other transcripts or notes with add_map_source, then read_map_sources has the agent read them all (a minute or two). Files (a pdf, a photo of a whiteboard) are added on the board first." : "Add the call or walk-through transcripts and notes with add_map_source, one per source. Then read_map_sources.";
    case "reading": return "The agent is reading the sources, a minute or two. Ask again with get_map_walk.";
    case "family": return `Say which product family this walk maps (answer_map_walk family): ${(s.options || []).map((o) => `${o.key} (${o.name})`).join(", ") || "name one"}. One walk maps one family; map_another_family starts the next from the same sources.`;
    case "customer": return "Give the customer, the demand and how often the plant ships (answer_map_walk customer: { who, demand, ships }), as the conversation said; ? where nobody said.";
    case "systems": return "Give the systems the plant uses, by their own names (answer_map_walk systems).";
    case "last": case "before": case "card": return "Give the family's material steps in the order the work moves, first step first, shipping last (answer_map_walk steps). Keep a step from found.steps by its key and change any field the conversation corrected; add a step the sources missed by name. Never make a field up: ? for a number nobody said.";
    case "supplier": return "Give the main supplier, what they send and how it is ordered (answer_map_walk supplier).";
    case "control": return "Give production control end to end, in order (answer_map_walk control): how an order becomes work on the floor.";
    case "review": return "Everything is answered. Read the walk back to the person, then draft_map_walk draws the map beside the current one.";
    case "drafted": return `The map is drawn beside the family's current map. The company's manager reads it and decides on the board whether to use it${where}; that step is not available here. The walk's review questions are on the map.`;
    case "used": return "The drawn map is now the family's map.";
    default: return "Nothing to do here.";
  }
}
async function shown(w, { full = true } = {}) {
  const v = await walk().view(w, { app: true });
  const board = boardOf(w.company);
  const head = { id: v.id, company: v.company, status: v.status, status_means: v.status_means, started: v.via === VIA ? "by Anetix, through a connected app" : "on the board, by the company", writable_here: v.via === VIA, family: v.family, board };
  if (!full) return { ...head, note: "This is a paying site's own walk. What it found and what was settled are not read here." };
  return { ...head, ...v, sources: v.sources.map(({ added_by, ...s }) => s), ai_cost_usd: Math.round(Number(w.cost_usd || 0) * 100) / 100, next: nextStep(v, board) };
}
async function pace(who) {
  if (!PER_HOUR) return;
  const n = (await q("SELECT count(*)::int AS n FROM platform.mcp_calls WHERE account_id=$1 AND ok AND tool = ANY($2) AND at > now() - interval '1 hour'", [(who.account && who.account.id) || 0, [...AI_STARTS, ...READS]])).rows[0].n;
  if (n >= PER_HOUR) throw say(`This account has sent ${n} things to the agent through a connected app in the last hour, which is the limit (${PER_HOUR}). Nothing was sent. Try again later, or do it on the board.`);
}
const ctxOf = (who) => { const by = byOf(who); return { actor: by, by: by.name, via: VIA }; };

const idArg = z.number().int().min(1).max(999999999).describe("The walk's id, from start_map_walk or list_map_walks");
const RECORD_KINDS = ["anetix", "other", "paper", "none"];
const stepShape = z.object({
  key: z.string().max(12).optional().describe("A step from found.steps (s1, s2, ...) to keep its evidence; leave out for a step the sources missed"),
  name: z.string().max(60).optional().describe("Two to four words; needed for a new step"),
  who: z.string().max(120).optional(), where: z.string().max(80).optional(), what: z.string().max(300).optional().describe("What happens, one line"),
  trigger: z.object({ from: z.string().max(60).describe('"arrival" (the work arrives from the step before), "person" (someone tells them), or a production control step\'s key or name'), how: z.enum(["system", "paper", "word"]), text: z.string().max(200).optional() }).optional(),
  record_kind: z.enum(RECORD_KINDS).optional().describe("anetix = an Anetix tool keeps it (name it in tools); other = another system; paper = paper, a whiteboard, an email or a text; none = nothing is kept"),
  record_system: z.string().max(120).optional(), tools: z.array(z.string().max(60)).max(8).optional().describe("The company's Anetix tools that keep this step's record, by name or title"),
  waits_before: z.string().max(80).optional().describe("What waits before this step, as said; ? when nobody said"),
  numbers: z.array(z.object({ label: z.string().max(24), value: z.string().max(60) })).max(8).optional().describe("Every number anyone said, as said, with units; ? when not known. Never estimated."),
  unsure: z.boolean().optional().describe("true when the conversation left this step in doubt; it becomes a review question"), note: z.string().max(500).optional(),
});
const tools = [
  {
    name: "list_map_walks", title: "Mapping walks",
    description: "The mapping walks (the guided walk that builds a plant's value stream map, one product family at a time): which company, which family, how far each got, and whether Anetix started it through a connected app or the company started it on the board. For one company or all, newest first.",
    input: { company: z.string().optional().describe("A company's slug; leave out for every company"), open_only: z.boolean().optional().describe("Only the unfinished ones. Default true.") },
    async run({ company, open_only }) {
      const slug = company ? slugArg(company) : null;
      const rows = (await q(`SELECT id, company, status, via, frame->>'family_name' AS family, jsonb_array_length(chain) AS steps, map_id, created_at, updated_at FROM platform.vsm_walks
                              WHERE ($1::text IS NULL OR company=$1) AND ($2::boolean IS FALSE OR status = ANY($3)) ORDER BY id DESC LIMIT 200`, [slug, open_only !== false, walk().OPEN])).rows;
      const own = new Map(), out = [];
      for (const r of rows) {
        if (!own.has(r.company)) own.set(r.company, await plantsOwn(r.company));
        const hidden = r.via !== VIA && own.get(r.company);
        out.push({ id: r.id, company: r.company, family: hidden ? null : r.family, status: r.status, status_means: walk().STATUS_WORDS[r.status] || r.status, steps_walked: hidden ? null : r.steps,
          started: r.via === VIA ? "by Anetix, through a connected app" : "on the board, by the company", writable_here: r.via === VIA, drawn_map: r.map_id || null, created_at: r.created_at, updated_at: r.updated_at });
      }
      return { walks: out };
    },
  },
  {
    name: "get_map_walk", title: "One mapping walk",
    description: "One mapping walk in full: its sources (titles and sizes), what the agent found in them (families, systems, production control, the material steps with who, trigger, record, waits, numbers and a quote, the supplier, open questions), the screen the walk is on, what was settled so far, and what to do next. Read this before answering and after reading the sources. A paying site's own walk shows only how far it got.",
    input: { id: idArg },
    async run({ id }) { const w = await load(id); return shown(w, { full: w.via === VIA || !(await plantsOwn(w.company)) }); },
  },
  {
    name: "start_map_walk", title: "Start a mapping walk", readOnly: false,
    description: "Start a mapping walk for a company, as Anetix, to fill in from calls and plant walks. If Anetix already started one that has not been read yet, that one is returned to carry on with. The board shows the walk as started by Anetix. Nothing is read and nothing is drawn by this.",
    input: { company: z.string().describe("The company's slug, from list_companies") },
    async run({ company }, who) {
      const slug = slugArg(company);
      if (!(await q("SELECT 1 FROM platform.companies WHERE slug=$1", [slug])).rows[0]) throw say("No company by that slug. list_companies names them.");
      const r = await words(() => walk().start(slug, ctxOf(who)));
      return { carried_on: r.carried_on, walk: await shown(await load(r.id)) };
    },
  },
  {
    name: "map_another_family", title: "Map another family from the same sources", readOnly: false,
    description: "Start a walk for the next product family from a walk Anetix started whose sources were already read: the sources and what was found in them are carried over, nothing is read again (no AI spent). Then answer it the same way.",
    input: { id: idArg },
    async run({ id }, who) {
      const w = await mine(id);
      const r = await words(() => walk().start(w.company, { ...ctxOf(who), fromWalk: w.id }));
      return { walk: await shown(await load(r.id)) };
    },
  },
  {
    name: "add_map_source", title: "Add a source to a mapping walk", readOnly: false,
    description: "Add one source to a mapping walk Anetix started, before it is read: a call or walk-through transcript, notes, an email, or a document's text. One call per source, in the person's own words, never a summary of them. A pdf or a photo is added on the board instead. Nothing is read by this.",
    input: {
      id: idArg,
      title: z.string().min(1).max(120).describe('What it is, for the evidence trail: "Walk-through with Arthur, Bruce and Bob, Oct 30"'),
      kind: z.enum(["transcript", "notes", "email", "document"]).describe("What kind of source it is"),
      words: z.string().min(1).max(300000).describe("The source's words, as they are"),
    },
    async run({ id, title, kind, words: text }, who) {
      const w = await mine(id);
      await words(() => walk().addWords(w.company, w.id, { title, kind, words: text }, ctxOf(who)));
      return { added: true, walk: await shown(await load(w.id)) };
    },
  },
  {
    name: "read_map_sources", title: "Have the agent read the sources", readOnly: false,
    description: "Have the agent read every source of a mapping walk Anetix started, and find the families, the customer, the systems, production control, the material steps, the supplier and the open questions. It takes a minute or two: read the result with get_map_walk. This spends the company's AI credit like the same button on the board. Sources cannot be added after the read.",
    input: { id: idArg },
    async run({ id }, who) {
      const w = await mine(id);
      await pace(who);
      await words(() => walk().read(w.company, w.id, ctxOf(who)));
      return { reading: true, walk: await shown(await load(w.id)) };
    },
  },
  {
    name: "answer_map_walk", title: "Answer a mapping walk", readOnly: false,
    description: "Write what the conversation settled into a mapping walk Anetix started, after its sources were read: any of the family, the customer, the systems, the material steps (the whole family in the order the work moves, first step first), the supplier and production control, in one call. Each part is checked and saved on its own, so a part that does not fit is reported back and the rest are kept. Answering again replaces the earlier answer. Use the plant's own words and names. Leave out what the conversation did not settle and tell the person; never make an answer up (a number nobody said is ?). Nothing is drawn by this.",
    input: {
      id: idArg,
      family: z.string().max(80).optional().describe("A family option's key from the walk's screen (map:..., ext:...) or the family's name"),
      customer: z.object({ who: z.string().max(120), demand: z.string().max(120), ships: z.string().max(120) }).optional(),
      systems: z.array(z.string().max(60)).max(12).optional().describe("The systems the plant uses, by their own names"),
      steps: z.array(stepShape).min(1).max(24).optional().describe("The family's material steps in the order the work moves, first step first and the last step before the customer last"),
      first_step_reached: z.boolean().optional().describe("false when the conversation did not get to where the work starts; default true"),
      supplier: z.object({ name: z.string().max(80), what: z.string().max(120).optional(), how_ordered: z.string().max(200).optional(), record_kind: z.enum(RECORD_KINDS).optional(), record_system: z.string().max(120).optional() }).optional(),
      control: z.array(z.object({ key: z.string().max(12).optional().describe("A step from found.control to keep it"), name: z.string().max(60), who: z.string().max(120).optional(), what: z.string().max(300).optional(), how: z.enum(["system", "paper", "word"]).describe("How it is passed on"), system: z.string().max(120).optional(), record_kind: z.enum(RECORD_KINDS).optional(), tools: z.array(z.string().max(60)).max(4).optional() })).max(6).optional()
        .describe("Production control end to end, in order: how an order becomes work on the floor"),
    },
    async run(args, who) {
      const w = await mine(args.id);
      if (!["walking"].includes(w.status)) throw say(w.status === "drafted" ? `Walk ${w.id} is drawn. The company's manager reads it on the board; nothing was changed.` : `Walk ${w.id} is not taking answers: ${walk().STATUS_WORDS[w.status] || w.status}. Nothing was changed.`);
      const { id, ...b } = args;
      if (!Object.keys(b).length) throw say("No answers were given.");
      const r = await words(() => walk().answerMany(w.company, w.id, b, ctxOf(who)));
      return { ...r, walk: await shown(await load(w.id)) };
    },
  },
  {
    name: "draft_map_walk", title: "Draw the map from the walk", readOnly: false,
    description: "Draw the map from a mapping walk Anetix started, once everything is answered: the process row in flow order, production control, supplier and customer, what waits before each step, the information flows, the data boxes, and a review question for every guess. No AI is spent. The map is put beside the family's current map as a draft; the company's manager decides on the board whether to use it.",
    input: { id: idArg },
    async run({ id }, who) {
      const w = await mine(id);
      const r = await words(() => walk().draft(w.company, w.id, ctxOf(who)));
      return { drawn: true, ...r, walk: await shown(await load(w.id)) };
    },
  },
];

module.exports = { tools, nextStep, READS };
