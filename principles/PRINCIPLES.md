# Operating principles

These rules govern every module and every change built by agents or humans.

1. **Operator-first.** Every screen is designed for the person on the floor. One prominent action per role. Phone and tablet first. Nobody should need training to use a page.
2. **Never make operators navigate.** A role gets its own view showing exactly what that role needs. No menus of menus.
3. **The manager gate is structural.** Nothing reaches a live module without a human approval. Agents write to staging only.
4. **Plain language everywhere a human reads.** Proposals, requirements, diffs, and failures are written for a production manager, not a developer.
5. **Small changes, shipped fast.** Prefer the smallest change that removes the reported friction. If a request is really three changes, say so and split it.
6. **Adoption is the deliverable.** A feature that is not used does not ship again in the next revision. Feedback recurrence decides priority.
7. **Every action on the record.** Agent runs, deploys, rollbacks, and decisions are logged and visible.
8. **The tour stays true.** Every module carries a `tour.json` (title, intro, steps of `path`, `target`, `title`, `body`) that walks a new operator through its screens, ending at the feedback button. When a change renames, moves or removes something a tour step points at, update that step in the same change. Targets are CSS selectors on the module's own pages; keep them to stable ids.
9. **Mark what you touched.** Every HTML element an agent adds or visibly changes carries `data-changed="vN"` (N = the version being built). The staged preview outlines those elements so the manager sees what is new without hunting; the attribute does nothing on the floor. One attribute per element; never remove older ones.
10. **Say when a number is an estimate.** Beside a date, a quantity or a schedule the tool works out (a due date, a finish time, a quantity to order, a load), put one quiet line: "Estimate. Check it before you promise it to a customer." Once per figure or table, not on every cell, and never on a number a person typed or counted. The company decides what it promises; the tool helps it check.
11. **Rules where the cases are known, judgment where they are not.** Fixed rules for what can be written down ahead of time: fields the tool holds, arithmetic, stages, a fixed layout. When the tool must read something from outside that it has not seen (a template or spreadsheet someone uploads, a supplier's file, notes in a person's own words) and line it up with what it knows, a list of other names is a guess that fails on the next file: the tool works that step out with the platform's judgment call, shows a person the result, and, when the same thing comes back again, remembers it and reuses it by rules. Decide this yourself; never ask a person to choose between ways of building. Ask only about what they will see.
