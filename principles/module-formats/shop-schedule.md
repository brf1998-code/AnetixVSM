# Module reference: Shop Schedule

What this module is: a job shop's schedule with finite capacity, for the office and the floor. Built 2026-10-19 by hand
(not by the agent) as a starter tool for demos, from what a machining and fabrication shop asked for: the schedule
showed infinite capacity, start dates moved every day so nothing was ever late until it was late at the end, the
commit date was measured at the shipping door instead of the customer's dock, and nobody could tell where a job was
without walking out to look.

Screens: `pages/board.html` (schedule board: the numbers, every open job in priority order with its locked start,
commit and projected dates, filters, arrows to move a job), `pages/job.html` (`/job/:id`: what is done and what is
left, the operations with locked and planned dates and the wait before each, hold, hot, move the commit date with a
reason, lock the dates again with a reason, cancel, history), `pages/center.html` (`/centers` the picker,
`/center/:id` one work center's queue for a tablet: running, here and ready with NEXT UP, held, coming; Start, Done,
Can't run it), `pages/load.html` (hours booked against hours available, 8 weeks, per work center; outside processing),
`pages/meeting.html` (the morning meeting in facts: late, missed starts, held with owner and date, at risk, due this
week, shipped), `pages/setup.html` (release a job with its routing, copy a routing from a part, work centers, ship
days, the example shop). Every page is built from the same head and helper script; keep the nav, `api()`, `say()`
and the date helpers the same on every page.

Data: `centers` (kind `machine` = hours a day, `outside` = days out), `jobs` (commit_date is the day due at the
customer's DOCK; priority; hot; hold, hold_owner, hold_until; locked_finish; status released, shipped or cancelled),
`ops` (seq, center, what, hours, status waiting, running or done, locked_start, arrived_at, started_at, done_at),
`log` (the job's history in words), `settings` (ship_days: shipping door to dock; seeded).

The plan (`routes.js plan()`, pure): open jobs in order (hot, then priority, then commit date); each operation that is
not done is placed on its work center's open hours day by day from the earliest day it can start (today, the end of
the operation before it, or the day a hold is expected to clear); a running operation counts as half done; outside
operations take their days and no hours. Projected dock = last operation's end + ship_days. State: late (projected
dock after commit), risk (held, a missed start, or under 3 days to spare), ok.

Locked dates: a job's operations get `locked_start` from the plan when it is released; only "Lock the dates again"
(manager, with a reason, on the history) moves them. A waiting operation whose locked start has passed is a missed
start. Never make the plan move locked dates on its own: that is the failure this tool exists to fix.

The example shop: on the first request to the tool, `firstUse()` puts in 11 work centers, 16 open jobs and 6 shipped
ones, all flagged `example`, dated from that day (one over-booked lathe, two outside processes, three held jobs, a few
late and a few with missed starts). Setup takes it out (jobs only, or the unused example work centers too) and puts it
back. Once taken out it never comes back on its own.

API: `GET /api/board` (everything), `GET /api/centers`, `GET /api/center/:id`, `GET /api/jobs/:id`; floor:
`POST /api/ops/:id/start`, `POST /api/ops/:id/done` (the last one ships the job), `POST /api/jobs/:id/hold {reason}`,
`POST /api/jobs/:id/clear-hold`; manager: `POST /api/jobs` (release, with `ops`), `POST /api/jobs/:id` (commit_date
with reason, hot, qty, hold_owner, hold_until, status cancelled), `POST /api/jobs/:id/move {dir}`,
`POST /api/jobs/:id/relock {reason}`, `POST /api/ops/:id/undo`, `POST /api/centers` (add or edit),
`POST /api/centers/:id/retire`, `POST /api/settings {ship_days}`, `POST /api/example/clear`, `POST /api/example/load`.
Every GET takes `?today=YYYY-MM-DD` from the screen (the plant's calendar day), used when within a day of the tool's.

Rules for changes: the commit date is the dock date; locked dates move only by a manager with a reason; the floor's
taps stay two (Start, Done) plus Can't run it; keep the work center page readable at arm's length on a tablet; new
numbers go into `/api/board` first, then the pages. What Rev 1 leaves out on purpose: people and shifts as a
constraint, material availability from purchase orders, an ERP connection (Epicor) to read jobs and routings, setup
time, splitting a job across two machines.
