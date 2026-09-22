# Which model is the baseline: the assessment

Written 2026-09-22, the day Opus 5.5 came out. Every model call in Symbiotic OS
now runs on one of two models, Fable 5.1 or Opus 5.5 (Haiku 4.5 still writes the
plain summaries and the plain-words rewrites, about a cent each). This doc is
how to decide which of the two is the **baseline**: the model every job runs on
unless a company pins it. The page is `/admin#models`; the code is
`src/assess.js`, `src/agent.js` and `health.abSplit`.

## The two

| | Fable 5.1 | Opus 5.5 |
|---|---|---|
| id | `claude-fable-5-1` | `claude-opus-5-5` |
| price, per million tokens | $10 in, $50 out | $4 in, $20 out |
| forced tool_choice | refused | refused |
| what we know | the model the loop has run on since 2026-09-17 | Anthropic's numbers put it ahead of Fable 5.1 on agentic coding (Terminal-Bench 4.0 66.4% vs 55.8%); nothing yet on our work |

Fable stays the baseline until our own evidence says otherwise. The stance from
the 2026-09-18 product review holds: a build that goes wrong on the floor costs
far more than the model does, so the cheaper model has to be shown **not
worse**, on our cases, before it takes over.

## The jobs

| job | what it covers | a company can pin it |
|---|---|---|
| propose | the proposal on arrival, the requirement before a functionality build, diagrams, ERP lookup drafts, a module's chat | yes |
| build | the build agent (most of the spend) | yes |
| review | the independent cross-check of a build | yes |
| design | a new module's questions, design, first build and its check; system reviews; brand guides | no |

A job can be given its own model on the Models tab ("A job of its own") when the
evidence splits, for example Opus 5.5 for builds and Fable for design.

## Step 1: the head-to-head (days, about $20 to $30)

Stored work is done again by both models, with the exact brief a real call
gets, and nothing reaches a board or the floor.

| kind of case | what it redoes | scored against | picked blind |
|---|---|---|---|
| Cross-checks | the review of a build you labeled Right or Wrong on the checks page | your label | no |
| Proposals | the proposal for a request you approved, against the module as it was then | what you approved: look and feel or how it works, and the screen | yes |
| Designs | a new module's design from the manager's answers | plain-words flags | yes |
| Builds | a change that shipped, rebuilt from the same version in a scratch folder | the module gate, and the cross-check of BOTH models (so no build only grades itself) | yes |

Rough cost per case, both models together: cross-check $0.46, proposal $0.36,
design $0.69, build $2.58. The suggested first run (10 cross-checks, 8
proposals, 3 designs, 5 builds) is about $22; set the stop at $30. It counts
against the company budgets and shows on the credit line as "assess".

Before starting:

1. Label cross-checks on each company's checks page (Right / Wrong). Five
   labels is the least that counts; ten is better. Wrong labels matter most.
2. Five shipped builds and five approved proposals is the least for those
   kinds to count. Designs will be thin (one or two intakes so far); read them,
   do not expect the numbers to decide anything.

Then start it on the Models tab and let it run. Pick blind as the answers come
in: each case shows Left and Right with no model, cost or time, and the side is
a fixed coin per case. Pick the one you would rather have had; "About the same"
and "Both miss" are real answers. The pick reveals which was which afterwards.

### How the page reads it

- A kind counts once it has 5 cases done on both models, and 5 picks when it is
  picked blind.
- On a kind that counts, the non-baseline model is **worse** when it lost 2 or
  more blind picks than it won, or its objective score (label agreement,
  proposals matching what you approved, builds the OTHER model's check passed)
  is 15 points or more under the baseline's. **Better** is the same the other
  way round.
- One kind worse: keep the baseline. Nothing worse and cheaper: the page
  suggests the switch and offers the button. Better but dearer: your call.

These thresholds are a first guess, written where the page shows them
(`RULES` in `src/assess.js`). With five cases a kind is still noisy: one pick
either way moves it. Read the answers, not just the counts.

## Step 2: the live A/B (two to three weeks of real use)

The head-to-head says which to try. The A/B says whether it holds on the floor.
Switch it on for proposals, builds and new modules. Each new one goes to
whichever model has had fewer of that job since the start; a build's
requirement and review stay on the build's model, so a run is one model end to
end. A company that pins a job stays out.

Read, per model: misses once live (the floor's "not quite", the manager's "a
little left"), rollbacks, reviewer and test stops, fix rounds, then spend. Wait
for 10 builds on each side before reading anything into it. A build's reviewer
is on the same side, so its stop count is builder and reviewer together; the
head-to-head's label agreement is the reviewer alone.

A reasonable bar to switch: after 10 or more builds each, the Opus 5.5 side
has no more misses and no more rollbacks than the Fable side, give or take one.

## Step 3: switch, or split

- Opus 5.5 held up in both: make it the baseline on the Models tab. Keep the
  A/B running a while longer if you want the cushion.
- It held up on builds and proposals but not design: keep Fable as the
  baseline and give build and propose their own model, or the other way round.
- It did worse anywhere that matters: keep Fable, and run the head-to-head
  again when the next model comes out. The cases stay stored.

## What it does not cover

- A build trial runs the module gate and both reviewers, not the acceptance
  checks or the screen load (those need a staged mount). The live A/B covers
  them.
- A proposal trial reads today's company docs, not the docs of the day the
  request came in.
- The cost estimate per case uses fixed token sizes. The spend line on each
  assessment is the real number.
- "Fable" is still the name of the designer in the intake flow, whichever
  model runs it.
