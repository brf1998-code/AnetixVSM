# Paid sites: a demo becomes a subscribed site

Concept, 2026-09-26. Stage 1 (the price book and the Sites tab of /admin) and stage 2
(Go live on anetix.ai, as far as Signed, shipped dark behind a switch) were built the
same day; stages 3 to 5 are not. What stage 2 changed from this plan, and why, is
"Stage 2 as built" below the build order. Brendan's decisions are marked
**decided**; everything else is a proposal and says so. The pricing strategy
Brendan wrote the same day is folded in, with the data it asked for.
Revised the same day after an adversarial review of the billing design:
activation retries, event order, where the fair-use check sits, the credit
epoch, tax, the internal routes, and manager-only routes.

## What Brendan asked for

"A pipeline where people are not just able to add credits but convert their
demo to an enterprise account. This is going to be extremely nuanced and needs
to be done correctly." It includes a subscription they can cancel at any time,
and it rolls them over to a full company with no usage limits, or at most 80%
of their subscription cost in AI, "which is extremely unlikely unless they are
intentionally doing it". Plus his pricing strategy, the data it needs, and
some of the thesis behind it.

## Decisions (Brendan, 2026-09-26)

From his pricing strategy:

1. Priced per site. Never per seat, never by usage. Everything inside a site is
   unlimited: users, modules, loops closed, builds. No landing fee, no metered
   pass-through.
2. Headcount (all shifts) sets the band. Floor space can move a site up one
   band, never more. Self-reported, no audit. Re-banded once a year, upward
   only.
3. A site is one address or contiguous campus under one plant manager.
4. Rate locked for existing customers when list prices change.
5. Integrations only if the customer wants them, a fixed one-time price per
   system. Hardware optional, pass-through at cost plus handling, kept out of
   subscription revenue.
6. Fair use is a backstop, not a meter. Billed monthly.
7. Enterprise: a master agreement signed once with corporate, then each site
   turns on with its plant manager signing a one-page order form. Band prices
   locked for the agreement's term, no minimum number of sites, tools copy
   between sites at no charge.

From the questions in this session:

8. **No start rate.** "They will go to full pricing right away depending on
   size of the site which based on the information they enter will determine
   what size they are." The strategy's entry point ($1,000 for the first N
   months) is gone. $1,000 is now simply the Small price.
9. **A fifth band: 50 to 99 people at $1,750**, chosen over keeping the 2.5x
   jump at 50.
10. **Activation waits for Brendan.** A site signs and saves a card. Nothing is
    charged until he presses Activate, and the first month bills then.
11. **Cancelling returns the site to a demo** at the end of the paid month. The
    manager keeps every tool and all data, floor access closes, and the AI runs
    on credit again. Resubscribing picks up where it left off. Data is kept
    until the customer asks for deletion, or until 12 months pass with no
    sign-in.
12. **The 80% line.** A site's AI cost in a billing month may not pass 80% of
    that month's fee.
13. **Switched on within 24 hours.** A signed site is activated within 24
    hours of the signature.

## Part 1: the pricing thesis

Five ideas carry the price book. They are written to be said out loud; the
customer-facing version is under "Copy" near the end.

**The unit is the site.** The product molds itself to one floor's process, so
the floor is what a customer buys. It also makes enterprise expansion
mechanical: forty plants at one company are forty one-page order forms at the
price book's prices, not one enterprise negotiation. Net revenue retention
comes from site count, which is forecastable.

**Never per person, never per use.** At Langmuir the board went from zero to
twenty-three users in six months with no mandate, and a per-seat price taxes
exactly that number. Every metered price is a reason to do less of the metered
thing, and the thing the floor has to do without thinking is close the loop.
This also settles the a16z review note ("say it one way"): there is no metered
line anywhere now.

**Cheap enough for the plant manager to say yes alone.** Corporate purchasing
cards commonly carry a per-transaction limit between $1,000 and $5,000
(DATABASICS), and manager-level cards a $3,000 to $5,000 monthly cap (Ramp). A
Small ($1,000) or Mid ($1,750) site fits inside that as a monthly charge with
no purchase order. Core and up meet procurement sooner, which is where the
master agreement belongs anyway. The plant manager's approval limit is a field
in the pipeline, so this gets measured instead of assumed.

**Tokens are not the margin problem.** The pilot unit economics put a site's AI
at $99 in a steady month with three new tools, $176 in a launch month and $357
in the high launch case, all at Fable prices. Opus 5.5, the baseline since
9/23, is 40% of Fable's price per token, so real months should sit well below
those. At $99 that is 10% of the smallest fee and 4% of Core. The 80% line
exists so no site can ever cost more in AI than it pays, even on purpose, and
normal use does not come near it (table below). Labor per site stays the
number that decides margin, as the business model doc says.

**Price by size, told to us.** Headcount is known before the sale, tracks how
much process there is to absorb, and changes no behavior worth protecting.
Self-reporting keeps the sale fast. The fifth band keeps every step between
bands at 1.75x or less, so there is little reason to shade the number.

## Part 2: the price book, with the data

### The bands (decided)

| Band | People at the site, all shifts | Monthly | Annual | Per person, bottom of band | Per person, top of band |
|---|---|---|---|---|---|
| Small | 1 to 49 | $1,000 | $12,000 | $50.00 at 20 people | $20.41 |
| Mid | 50 to 99 | $1,750 | $21,000 | $35.00 | $17.68 |
| Core | 100 to 199 | $2,500 | $30,000 | $25.00 | $12.56 |
| Large | 200 to 499 | $3,500 | $42,000 | $17.50 | $7.01 |
| Very large | 500 and up | $5,000 | $60,000 | $10.00 | $5.00 at 1,000 people |

Large and Very large were "proposed" in the strategy and are still proposed.
The steps between bands are 1.75x, 1.43x, 1.40x and 1.43x. The strategy's
ranges shared their edges ("50 to 200", "200 to 500"); here 200 is Large and
500 is Very large.

### Where US plants fall

Manufacturing establishments by size, BLS Quarterly Census of Employment and
Wages, March 2026. An establishment is one physical site, the same unit the
price book sells.

| People | Sites | Share of sites with 20 or more | Band |
|---|---|---|---|
| 20 to 49 | 46,989 | 49.4% | Small |
| 50 to 99 | 22,614 | 23.8% | Mid |
| 100 to 249 | 16,894 | 17.8% | Core up to 199, Large from 200 |
| 250 to 499 | 5,465 | 5.7% | Large |
| 500 and up | 3,114 | 3.3% | Very large |
| 20 and up | 95,076 | | |

Below 20 people there are 308,527 more sites. The beachhead leaves them out,
and they would pay the Small price.

At list price the US sites with 20 or more people come to **$1.96B to $2.17B a
year**, an average of $1,720 to $1,897 a month per site. The range exists only
because BLS's 100 to 249 class straddles the Core and Large line at 200 (all of
it Core gives the low end, all of it Large the high end).

Two things follow:

- The Mid band gives up $204M a year of list value against the old four-band
  book, because 23.8% of sites sit at 50 to 99 people. That is what the smaller
  steps cost (decided).
- The VC deck's "$100M ARR is 3,333 plants" uses $30,000 per plant. $30,000 is
  now the Core price, not the average. At the US mix, $100M ARR is about 4,400
  to 4,850 sites. 3,333 holds only if the mix leans Core and up, which the
  enterprise motion might do. The deck should say which it means.

### Floor space moves a site up one band (proposal)

Five bands need four square-foot thresholds, one at each band edge. Proposal:
**1,500 square feet per person at each edge, so 75,000, 150,000, 300,000 and
750,000 square feet.** A site at or over the threshold for the next band up
moves up one band, never more.

Why 1,500: an employment density study for industrial land planning uses 500
square feet per employee for manufacturing and 1,000 for wholesale,
transportation and warehousing (Snohomish County), and the Metropolitan
Council's planning handbook uses 1,500 for warehouse jobs. At three times the
manufacturing norm, only sites that are clearly big for their headcount move:
heavy automation, big products, a lot of storage. That is what the rule is for.

The two prospects with data show both cases. Chelsea Clock is about
15,000 square feet for 20 to 22 people, 680 to 750 per person, so Small by
headcount and nowhere near a threshold. NEWP lists about 683,000 square feet
across five sites for somewhere between about 200 people (ZoomInfo's low end)
and about 600 (the 2020 PPP count plus the 2022 expansion), so 1,100 to 3,400
per person: the kind of storage-heavy maker the rule is meant for, decided
site by site from each site's own headcount.

Worked examples: a 22-person, 15,000 square foot shop is Small at $1,000. A
40-person site with 110,000 square feet is Small by headcount but over 75,000,
so Mid at $1,750. A 150-person site with 215,000 square feet is Core by
headcount and under 300,000, so it stays Core at $2,500.

The more aggressive option is 1,000 per person (50,000, 100,000, 200,000,
500,000). It would move ordinary plants, which is not what the rule is for.

### The fair-use line (decided at 80%)

| Band | Fee | Fair-use line | Brendan alerted at | Gross margin if a site sits at the line | Line against the $357 high launch case |
|---|---|---|---|---|---|
| Small | $1,000 | $800 | $500 | 17.5% | 2.2x |
| Mid | $1,750 | $1,400 | $875 | 18.6% | 3.9x |
| Core | $2,500 | $2,000 | $1,250 | 19.0% | 5.6x |
| Large | $3,500 | $2,800 | $1,750 | 19.3% | 7.8x |
| Very large | $5,000 | $4,000 | $2,500 | 19.5% | 11.2x |

The margin column includes $25 a month of infra per site, from the unit
economics. The $357 is the modeled high case (Langmuir's measured request
volume at Fable prices), not a measured month. The alert is at half the fee, a
private signal for Brendan; the customer never sees it.

### Add-ons (open)

**Integrations:** [INTEGRATION PRICE] stays open until there is a measurement:
the engineer-days one read-only ERP connection actually takes, times the
$1,023 loaded engineer-day in the business model doc, plus margin. The Epicor
connection at Langmuir is the first measurement and SAP the second.

**Hardware:** pass-through at cost plus handling, invoiced once, never in the
subscription. The reference kits are $2,045 lean and about $4,580 with label
printing.

Both are one-time Stripe invoices Brendan raises from the Sites tab (stage 5).

### Rate lock and the yearly size check

The price book is versioned (`platform.price_books`, one row per version).
Every site records the version it signed under, and its band price comes from
that version for as long as the subscription runs, including a later move up a
band. A new list price is a new version with new Stripe Prices. No Stripe Price
is ever edited, so existing subscriptions keep theirs with no code at all.

Once a year, on the site's activation anniversary, Settings asks the manager to
confirm headcount and floor space. The same band or a lower one changes nothing
(upward only). A higher band starts with the first bill at least 30 days after
the confirmation, and the manager is shown the date and the new price on the
spot.

How the new price reaches Stripe: not through a subscription schedule, because
the customer portal cannot cancel a subscription that has a scheduled update,
which would take away "cancel any time" for a month. The site stores the band
and the bill it starts from. Right after the bill before that one is paid, the
product asks anetix.ai to move the subscription to the new Price with
`proration_behavior=none`, so the next bill is the first at the new price and
nothing is prorated.

A site that leaves and comes back signs at the list prices of that day: the
lock lasts while the subscription does.

## Part 3: the pipeline

### The life of a site

A site has a stage. While it is subscribed it also has a payment standing and,
separately, a cancel date. The two can be set at once (a card fails in the
month someone cancels), so they are fields of their own, not more stages.

| Stage | How it gets there | The manager sees | The floor | AI | Billing |
|---|---|---|---|---|---|
| Demo | a pin (today), or a Decline | the DEMO strip, credit as a percentage | no access | on credit | top-ups |
| Ordering | the manager opens Go live and saves the site's facts, or Brendan sends an order back | the demo as before | no access | on credit | nothing |
| Signed | the order form is signed and a card saved | "Your order is in" | no access | on credit | card saved, nothing charged |
| Activating | Brendan pressed Activate and the Stripe steps are running | "Your order is in" | no access | on credit | the first charge is being made |
| Subscribed | the first charge went through and the rollover ran | no strip, no meter | the floor password works | unlimited to the fair-use line | monthly |
| Back to demo | the paid month ended, or the subscription was ended | "A demo again" | access closed | on credit, from 0% | top-ups |

While a site is Subscribed:

| Standing | Comes from | The manager sees | The floor | AI |
|---|---|---|---|---|
| Good | Stripe status `active` | nothing | works | to the fair-use line |
| Past due | Stripe status `past_due` (Smart Retries, 8 tries in 2 weeks by default) | "Update the card", nothing stops | works | works |
| Unpaid | Stripe status `unpaid`, once the retries run out | new AI work paused | works | paused |
| Cancel date set | `cancel_at_period_end` | "Ends on (date)", with Keep it | works | as the standing says |
| Needs attention | a dispute or a refund (`charge.dispute.created`, `charge.refunded`) | nothing | works | works |

The rules:

- **Billing never takes a floor down by itself.** Only a person closes the
  floor's access: the customer cancelling, or Brendan pressing End. Payment
  trouble pauses new AI work at most.
- **A cancel on an unpaid month ends it now.** If a cancel date is set while
  the site is past due or unpaid, the subscription ends at once, the open
  invoice is voided, and the site goes back to a demo. The order form says a
  cancellation takes effect at the end of the month already paid, and that
  month is already over. Left to Stripe, it would run to the end of a month
  nobody paid for, AI included.
- **A dispute or a refund** puts the site under Needs attention with a red pill
  for Brendan. Nothing changes on its own; he decides.
- **Decline returns the site to Demo**, so Go live works again.
- **"Subscribed" is the test** wherever the code asks whether a site pays. The
  credit gate is off for every standing above, and Unpaid pauses AI by its own
  rule.

A returning site goes Back to demo, Ordering, Signed, Activating and Subscribed
again, with every tool and all its data where they were.

### Go live: the customer's side, on anetix.ai

It starts from a "Go live" link a demo's manager sees in two places: on the
credit line next to Add credit, and in Settings. The out-of-credit panel offers
it too, since that is the natural moment. The link is signed by the product
(HMAC over `golive:<slug>:<exp>` under `SOS_WWW_KEY`, 31 days, the same shape
as `selfserve.creditToken`), so anetix.ai never says a company exists to anyone
without it. It is only issued to a site in Demo, Ordering or Back to demo, and
because it lives 31 days, anetix.ai asks the product for the site's stage again
on every request.

Four screens, one group of questions on each (the module intake's rule):

1. **About your site.** The company's legal name, the site's name, its address,
   the people who work there counting every shift, its floor space in square
   feet, the plant manager (with "That's me"), the person's own name and title,
   the billing email, and the billing address (the site's unless changed). Two
   optional boxes: "We'd like to connect our ERP" (which one) and "We'd like
   hardware (tablets, scanners, a label printer)". And the learning opt-in,
   unticked (as built: it moved here from screen 4 so that it is part of the
   signed words; see Stage 2 as built). The draft is saved on every screen, so a
   closed tab loses nothing.
2. **Your price.** The band from what they entered, worked out by the product
   and never by the page, in one line: "(Site) is a Core site, 100 to 199
   people. $2,500 a month, billed monthly. Cancel any time." Then the "How we
   price" box and what is included.
3. **Who signs.** "I'll sign" or "Someone else approves this". The second gives
   a link (HMAC over `order:<id>:<exp>`, 14 days, dead once signed) that opens
   screens 2 to 4 with the answers filled in, for whoever approves spending.
4. **Sign.** The order form with every figure in it, one tick box ("I have read
   the order form and the terms, and I can sign for (Company)"), and the
   signer's typed name, title and email. "Sign and add a card" makes (or reuses) the
   site's own Stripe Customer and goes to Stripe Checkout in setup mode for it,
   with `payment_method_types[]=card`: the card is saved and nothing is
   charged. Back from Stripe: "Your order is in. Anetix switches (Site) on
   within 24 hours, and your first month is billed then. Until then
   your demo works as it does now."

The rules that keep an order honest:

- **One open order per site.** A partial unique index on `orders (site_id)` for
  draft, signed and activating orders. Starting again voids the old one.
- **What is signed is what was shown.** Every draft has a version. The sign
  call carries the version and the SHA-256 of the text the signer saw, and it
  is applied only if both still match. If the manager and the approver both
  have it open and one changes the headcount, the other is asked to look again.
- **One card per order.** One setup session per order; if a second one
  completes anyway, its card is detached.
- **The signer's own address.** The sign call is server to server, so the
  product's `edge.clientIp` would record the www service. anetix.ai passes the
  signer's address and browser from its own request.
- **A setup session is not a payment.** www's `fulfil()` treats any session
  whose `payment_status` is not "paid" as pending, and a setup session finishes
  as `no_payment_required`, so the webhook backstop would drop every signed
  order. It has to look at `mode` first.

A signed order is kept exactly as signed: the text, its SHA-256, the terms
version, the signer's name, title and email, the time, their address and
browser. It is never edited. A correction is a new order.

### Activation: Brendan's side, on the Sites tab

A signed order shows at the top of the Sites tab and as an amber pill on
/admin ("1 order to switch on"). Its card shows the facts, the band and price,
the demo's history (what was built, spent and asked for, as on the Demos tab),
and three checks:

- **Size.** A headcount within five below a band edge (45 to 49, 95 to 99, 195
  to 199, 495 to 499) is flagged, and so is floor space that looks off for the
  headcount.
- **Tenancy.** The count of subscribed sites on this instance. From the second
  one on, the button asks: "Your rule is a runtime per customer before a second
  customer's production data. Activate anyway?" The reason typed is kept on
  the site.
- **The AI key.** A paying site's loop stops if the Anthropic key runs dry, so
  Activate refuses until the admin credit note (`platform.ai_credit.autofill`)
  says auto reload is on.

If the facts look wrong, Brendan does not edit a signed order. "Send back"
voids it with a note the manager sees, the site returns to Ordering with a new
draft holding the old answers, and the customer signs again.

Activate asks for a fresh authenticator code, like delete and restore, and
then:

1. The order moves to Activating under a row lock, so a second press, a second
   tab or a retried request finds it taken.
2. The product asks the www service for three Stripe steps. Each has its own
   idempotency key built from the order id, the step and the payment method,
   and each Stripe id is written to the order the moment it exists, so a retry
   resumes where the last try stopped instead of starting over:
   1. the site's Customer (made at signing) gets the saved card as its
      `invoice_settings.default_payment_method`;
   2. any unused paid demo credit becomes a customer balance credit (below);
   3. the Subscription, on the signed order's band, price and price book
      (never the site's current facts), with `off_session=true`,
      `payment_behavior=error_if_incomplete`, `automatic_tax[enabled]=true`
      once tax is on, and metadata `{ site, order, price_book }`.
3. If the charge goes through, the rollover runs. The rollover is one function
   that is safe to run twice, and it runs on whichever comes first: the answer
   to Activate, or the subscription's first `invoice.paid`.
4. Only a `card_error` is a decline. The order goes back to Signed, the balance
   credit is reversed, the manager sees "Your card was declined. Use another
   card." with a fresh setup link, and Brendan's card says why. Anything else
   (a timeout, a 409, Stripe down) is not a decline: the product first looks
   for a subscription on the Customer carrying this order's id, and carries on
   from what it finds.

Decline takes a reason the manager is shown, reverses any balance credit,
detaches the card and returns the site to Demo.

### The rollover: exactly what changes in the product

| What | As a demo | Subscribed | Where in the code |
|---|---|---|---|
| DEMO strip | on | off | `platform.companies.demo` false |
| Credit gate | on | off, whatever the standing | `selfserve.assertCredit` checks the fair-use line instead |
| AI limit | the credit | the fair-use line | inside `selfserve.assertCredit`, the one gate every start passes (below) |
| Company monthly cap | as set | not used | `agent.companyCap` answers 0 for a subscribed site |
| Instance cap | applies | never applies | `SOS_MONTHLY_CAP_USD` still counts everything but refuses demos only |
| Top-ups | allowed | refused | `addCredit` refuses a purchase for a subscribed site, the top-up page checks the stage, and one that lands anyway is refunded |
| Floor access | none | a floor password, shown once to the manager | `auth.setPasswords(slug, { floor })`, kept encrypted until collected, like `self_serve.handout_enc` |
| Sample data | per tool | cleared if they chose it (default yes) | `src/sample.js` Clear on every tool with a fill in force |
| Display name | what they typed at the pin | the site's name | `platform.companies.name`; the slug never changes |
| Record | the demo's | a line at `sites.converted_at` | before it: demo learning data; after it: the plant's |
| Demos tab | listed | "Subscribed since (date)", demo period only unless opted in | `src/demos.js` |
| Board credit line | shown | gone | board payload `credit` null |
| Sample data link | on each tool | gone | demo only, as now |
| Manager accounts | one | the same one, plus Add a manager | Settings |

**Unused paid credit comes back.** Free credit (the demo grant, admin grants) is
counted as spent first. What is left of the credit they bought, never more than
the balance, is credited on the first bill at the rate they paid: a refill
bought at $20 for $10 with 70% of it left comes back as $14. It is small money,
and it is the same "no rip-off" rule as the percentage display. It is written
as a Stripe customer balance credit before the subscription, so Stripe applies
it to the first invoice. Its id is kept on the order, reused on a retry and
reversed on a decline. The ledger itself is not touched: while a site is
subscribed the credit gate is off, and the credit epoch (below) starts it
fresh if the site ever comes back to a demo.

### Living as a paid site

The product is the one a demo has, minus the demo parts. There is no meter
anywhere a manager or operator looks: no credit line, no spend, no percentage.
A meter would be a price on every use by the back door, and it breaks the rule
about not overloading the manager.

New in Settings, for managers only (see Routes: the floor shares one password,
so none of this may be open to a floor login), because a full company has to
run itself:

- **Your subscription:** the band, the price, the next bill date, the price
  lock, and "Manage billing", which opens Stripe's customer portal (card,
  invoices, cancel). The product signs a ten-minute link (`billing:<slug>:
  <exp>`) and anetix.ai turns it into a portal session, so the Stripe key stays
  on one service.
- **Floor password:** shows that one is set and makes a new one, which signs
  the floor out, as the admin's button does today.
- **Managers:** "Add a manager" makes a one-time link, good for seven days,
  that the manager sends on. The new person sets a password and an
  authenticator or a passkey. Nothing sends mail yet, so it is a link, like a
  pin.
- **Learning:** the opt-in from the order form, changeable any time.
- **Size, once a year:** the confirmation above.

### The fair-use line, exactly

- **Window:** the subscription's current period. anetix.ai re-reads the
  subscription at every Stripe event and forwards its period, so the window
  moves at each renewal even when the payment fails (a renewal fires
  `customer.subscription.updated` paid or not). Activation seeds it. If the
  stored period has ended and no event has come, the gate rolls it forward a
  month from the billing anchor instead of using a stale window.
- **What counts:** the meter, `platform.ai_calls`, by `company` and `at`: every
  API answer at the moment it arrives. A build's `build_runs` row is dated when
  the build starts while its cost keeps growing, so windowing the feature rows
  would book a build that crosses a renewal to the old month. Day by day it
  takes the larger of the meter and the feature rows, as `src/credit.js`
  already does. Diagrams count: they are Anetix's cost whether anyone asked for
  them or not. (A demo's credit leaves them out, and that stays.)
- **The line:** 80% of the band price, before tax and before any credit on the
  bill.
- **Where it is checked:** inside `selfserve.assertCredit`. Four starts call it
  directly and never pass `agent.assertUnderCap`: a new tool (`intake.js`
  line 105), starting one over (237), a tool build that never started (510)
  and a manager's Retry (`pipeline.js` 693). A check only in
  `assertUnderCap` would miss tool creation, the most expensive work there is.
- **What "already started" covers:** for a subscribed site, `opts.started`
  covers the same run only. A build confirmed later, an intake round opened
  later, and a queued run when it actually starts are new starts and are
  checked. So the line can be passed only by work that was already running when
  it was reached, one run per tool at most.
- **At the line:** new AI work is refused with the fair-use message. Work
  already running finishes. The floor's tools never notice. The manager's
  board says it once, in the warnings.
- **Before the line:** at half the fee, an amber pill on /admin and a flag on
  the site's row. Nobody on the customer's side is told.
- **Lifting it:** Brendan can lift the line for the rest of the period from the
  site's card (a big first month of new tools, say), with a note. The lift ends
  with the period.

### Stripe, end to end

Every Stripe call stays in the www service, which already holds the key. The
product never holds it. Agent-written code runs there (in processes of its
own), and keeping the payment key a service away is safer still.

**The internal routes are a second listener.** Railway's public domain and its
private hostname reach the same port, so a route on www's main app is public
whatever network the caller uses. www opens a second port with no public
domain for `/internal/*`, reached over Railway's private network (both services
are in the `symbiotic-os` project). The two directions use two keys:
`SOS_WWW_KEY` for www calling the product, as today, and a new
`WWW_INTERNAL_KEY` for the product calling www. `WWW_SECRET` must be set on
anetix-www; without it www signs its cookies with `SOS_WWW_KEY`.

**One Stripe Customer per site.** A portal session shows everything on its
Customer, so a shared Customer would let one site's manager see and cancel
another site's subscription. `platform.customers` groups sites for a master
agreement. One invoice across a customer's sites is a stage 5 question.

Set up once:

- One Product, "Anetix site", and one monthly Price per band per price book
  version, with lookup keys like `site_core_v1` and `tax_behavior=exclusive`.
- The customer portal: payment method updates and invoices on; cancellation on,
  at the end of the billing period, with the reasons list on; plan switching
  off (the band is ours to set); promotion codes off.
- Revenue recovery: Smart Retries (Stripe's default is 8 tries in 2 weeks),
  then **mark the subscription unpaid**, not cancel, so Brendan decides.
  Emails for failed payments and expiring cards on. Receipts on.
- The webhook endpoint made through the API with `api_version=2024-06-20`. An
  endpoint added in the dashboard gets Stripe's newest version, and the pin in
  `www/stripe.js` covers calls, not webhook payloads.

Keep the pinned `Stripe-Version: 2024-06-20`. From 2025-03-31 (basil) Stripe
moved `current_period_start` and `current_period_end` off the subscription and
onto its items, and an invoice's link to its subscription moved under `parent`.

**Every event is re-read.** Stripe does not deliver events in order, and an
invoice's own metadata is empty. So for every subscription, invoice or charge
event, anetix.ai checks the signature, fetches the subscription itself on the
pinned version, and forwards its id, status, cancel date, current period and
metadata. The product:

- takes the standing only from that fetched status, never from the event's
  type or arrival order;
- applies it only if that subscription is the site's current one, so an old
  subscription's late `deleted` cannot take a new floor down (those events are
  recorded and ignored);
- finds the site by the permanent site id in the metadata, and if the site's
  order is still Activating answers 5xx, so Stripe tries again later;
- stores the event id in the same transaction as its effect, so a replay does
  nothing.

| Event | What happens |
|---|---|
| `checkout.session.completed`, mode setup | the order is Signed, with its payment method |
| `checkout.session.completed`, mode payment | a credit top-up, as today |
| `customer.subscription.updated`, `invoice.paid`, `invoice.payment_failed` | the standing, the cancel date and the period, from the fetched subscription; the manager's banner and Brendan's pill follow the standing |
| `customer.subscription.deleted` | Back to demo, if it is the site's current subscription |
| `charge.dispute.created`, `charge.refunded` | Needs attention and a red pill; nothing changes on its own |
| `invoice.finalization_failed` | Brendan's pill (usually a tax address) |

### Cancel, and back to a demo

Cancelling happens in the portal and takes effect at the end of the paid
month, with no partial refunds. Until then everything runs, and the manager's
board says so with a way to keep it. A cancel set on a past due or unpaid month
ends at once (see the life of a site).

At the end (`customer.subscription.deleted`, or End):

- `platform.companies.demo` is true again and the strip comes back.
- The floor password is removed (`auth.accountsOnly`), which signs the floor
  out.
- The credit gate returns, counting from that moment. `self_serve.credit_since`
  (new) bounds both sides of the balance, the ledger rows and the spend, so
  they start at 0% and add credit on anetix.ai like any demo. (Bounding only
  the spend would hand back the whole demo's spend as credit.)
- Tools, data, versions, the record and the manager accounts are untouched.
- The site row keeps its history, with `returned_at` set.

Data retention (decided): kept until the customer asks for deletion, or until
12 months pass with no sign-in. Nothing sends mail yet, so the Sites tab lists
back-to-demo sites nearing 12 idle months, and deletion is Brendan's button,
with the customer told first.

### The Sites tab: the pipeline

A tenth tab on /admin, between Demos and Companies. Pins keeps demo requests
and pins, Demos keeps what the demos teach, and Sites is everything from
Ordering on.

Across the top, a count per stage: Ordering, Signed (waiting on you),
Subscribed, Needs attention (past due, unpaid, at the fair-use line, a dispute
or a refund), Cancelling, Back to demo. Below, one row per site with the fields
from the pricing strategy:

company, site name and address, plant manager, headcount, square feet, band,
demo pin holder and demo start date, tools built in the demo, integrations
requested, hardware requested, master agreement (yes or no, signed date), plant
manager approval limit, monthly price, stage and standing, next bill, this
period's AI as a share of the line, and the edge flag.

The strategy's "start rate end date" and "monthly price after step-up" went
with the start rate. Integrations and hardware come from the go-live form's
optional boxes and can be edited. The master agreement and the approval limit
are Brendan's to fill in. Actions on a site: Activate, Decline, Send back,
lift the fair-use line, End (unpaid only), and a note.

A site that never had a demo, like an enterprise plant under a master
agreement, gets "New site" in stage 5: Brendan enters the facts, the company is
made the way an admin company is today, and its plant manager gets the same
order link.

### Data model

New tables, all added to `backup.js` `PLATFORM_TABLES`, none of them columns on
`platform.companies` (pages read that table with SELECT *). A site gets a
permanent id at its first order, and that id, never the slug, is what Stripe
metadata, orders and billing events point at: `freeSlug` hands a freed slug to
the next company with the same name.

```
platform.price_books     version, effective_at, bands (JSON: name, min and max people, monthly usd,
                         square-foot threshold, Stripe price id), fair_use_share (0.80), note
platform.customers       id, legal_name, master_agreement_at, master_agreement_until, master_price_book,
                         invoice_days, note
platform.sites           id (uuid, permanent), company (the slug, unique), customer_id, stage, standing,
                         cancel_at, band, price_usd, price_book, headcount, sqft, site_name,
                         site_address (JSON), billing (JSON: email, address), plant_manager (JSON),
                         stripe_customer (unique), stripe_subscription (unique), period_start, period_end,
                         activated_at, returned_at, converted_at, reband (JSON: band, from),
                         learning_opt_in, fair_use_lift (JSON: until, by, note),
                         deal (JSON: integrations, hardware, approval_limit, note), tenancy_note,
                         attention (JSON), updated_at
platform.orders          id, site_id, state (draft, signed, activating, activated, declined, void), version,
                         facts (JSON), band, price_usd, price_book, terms_version, text, text_sha256,
                         signer (JSON), signed_at, signed_ip, signed_ua, payment_method, setup_session,
                         stripe (JSON: the ids made so far), balance_txn, note, created_by, created_at
                         (partial unique index on site_id where state is draft, signed or activating)
platform.billing_events  stripe_event (primary key), type, site_id, subscription, received_at, applied (JSON)
```

Plus `self_serve.credit_since`, the moment the credit counts from.

As built in stage 2, `platform.orders` also keeps `terms_sha256`, `signed_net` (the
evidence behind the signer's address), `card`, `kind` (customer or preview),
`from_stage` (the site's stage before the order, for Withdraw) and `voided_by`; and
`platform.terms_versions` keeps each terms version's words at its first signature.

**Delete and restore.** A company delete is refused while its site is
subscribed: End first, which voids open invoices, because the admin delete
(`src/feedback.js`) never talks to Stripe and the card would go on being
billed. After a delete, orders and billing events stay, keyed by the site id,
because they are the contract and the payment record (counsel to confirm). A
restore can bring back an old picture (an activated order as Signed, a
cancelled site as Subscribed), and Stripe does not resend events it already
delivered, so after a restore every site with a subscription is checked
against Stripe before Activate or End will run.

### Routes

As built in stage 2, the product's side for the www service is `POST
/api/www/golive/{view,save,approver,sign,checkout,start-over,card}` and `GET
/api/www/golive/terms`, each with the link the person holds; the admin's are `GET|POST
/api/admin/golive` (the switch), `GET /api/admin/sites/:slug/golive-link|orders` and
`POST /api/admin/sites/:slug/void-order`; the manager's is `GET /api/c/:slug/golive`.
The list below is the plan for all the stages.

anetix.ai (the www service), public:

- `GET|POST /c/:slug/go-live` (the product's token) and `GET|POST /order/:id`
  (the approver's token): the four screens, the stage checked on every request.
- `GET /c/:slug/go-live/done` and `GET /order/:id/done`: back from Stripe.
- `GET /c/:slug/billing`: a portal session, then a redirect to Stripe.
- `POST /webhook`: the new events, re-read and forwarded to the product.

anetix.ai, the second listener (private network, `WWW_INTERNAL_KEY` only):
`POST /internal/customer`, `/internal/activate`, `/internal/end`,
`/internal/reband`, `/internal/refund`.

The product:

- For the www service: `POST /api/www/orders` (make or update a draft; answers
  with the band and price it worked out, and the version), `GET
  /api/www/orders/:id`, `POST /api/www/orders/:id/sign` (with the version, the
  hash shown, and the signer's address and browser), `POST
  /api/www/orders/:id/card`, `POST /api/www/billing-events`, `GET
  /api/www/sites/:slug/stage`.
- Admin: `GET /api/admin/sites`, and on `/api/admin/sites/:slug/`: `activate`
  (with the step-up code), `decline`, `send-back`, `end`, `lift`, `deal`.
- Manager: `GET /api/c/:slug/subscription`, `POST /api/c/:slug/floor-password`,
  `POST /api/c/:slug/managers/invite`, `POST /api/c/:slug/learning`, `POST
  /api/c/:slug/size`.

**Every manager route uses `requireManager`**, as `src/sample.js` does.
`auth.companyGuard` checks the company, not the role, and the floor shares one
password, so without it any floor login could invite itself as a manager, open
the billing portal, reset the floor password or change the site's size. The
`/api/www/*` routes are opened by the shared key before the session middleware,
as today. None of the new session routes is addressed by an id; one that is
later goes into the `OWNERS` table in `src/auth.js` (the hard rule).

### The order form (draft for counsel)

One page. The parts in parentheses are filled from the order. [TERMS URL] and
[TERMS VERSION] are counsel's.

> **Anetix site order form**
>
> **Customer:** (legal name). **Site:** (site name), (address). **Plant
> manager:** (name). **Billing email:** (email), where notices go.
>
> **Size, as stated by Customer:** (n) people across all shifts, (n) square
> feet. **Band:** (band).
>
> **Fee:** $(price) a month, billed monthly in advance to the card on file,
> plus sales tax where it applies. The first month is billed on the day Anetix
> switches the Site on.
>
> **Term:** month to month. Customer may cancel at any time. A cancellation
> takes effect at the end of the month already paid, and partial months are not
> refunded.
>
> **Included:** use of Anetix at the Site by any number of Customer's people,
> with no limit on tools, requests or changes.
>
> **Fair use:** if Anetix's own AI cost for the Site in a billing month passes
> 80% of that month's fee, new AI work pauses until the next billing month. The
> Site's tools keep working.
>
> **Price:** Anetix will not raise the Site's price while this subscription
> continues, except to move the Site up a band when its stated size grows.
> Customer confirms the Site's size once a year, and the band can only move up.
>
> **Data:** Customer owns the data its people put into Anetix, and Anetix uses
> it to run the service for Customer. Customer's data is never shown to another
> customer.
>
> **Learning:** (either) Customer opts in. Anetix may learn from how the Site
> uses the system, to improve Anetix for all customers. (or) Customer does not
> opt in. Anetix does not learn from how the Site uses the system to improve
> Anetix for other customers.
>
> **After a cancellation:** the Site becomes a demo account for Customer's
> manager. Customer's data is kept until Customer asks for its deletion, or
> until 12 months pass with no sign-in.
>
> **Add-ons:** integrations and hardware are optional and quoted separately.
>
> **Unused demo credit:** credit Customer bought for its demo and has not used by
> the day the Site is switched on comes off the first bill, at the price Customer
> paid for it.
>
> **Terms:** this order form is an Order Form under the Anetix Terms of
> Service, version (version), at (anetix.ai/terms).
>
> **Signed for Customer** by (name), (title), on (date), who confirms they may
> sign for Customer.

### Copy (drafts; the voice rules apply)

**How we price**, on screen 2:

> We charge one price per site. Inside it everything is unlimited: people,
> tools, requests and the changes the AI builds.
>
> We never charge per person or per use. The system gets better each time
> someone on the floor uses it, and a price on every use would teach people to
> use it less.
>
> The price is set by the size of the site, which you tell us. It stays locked
> while you stay, and you can cancel any time.

**The go-live page's opening:**

> Your demo becomes your site, with everything you built still in place. From
> then on your floor has its own way in and the AI has no credit to run out of.

**The manager's board**, in the warnings:

- Signed: "Your order is in. Anetix switches this site on within 24
  hours."
- Subscribed, first view: "(Site) is live. The floor's password is (password). It is
  shown once, so write it down." [Print the wall sign] [Settings]
- Past due: "Your last payment did not go through. Nothing has stopped."
  [Update the card]
- Unpaid: "Payment has failed for two weeks, so new AI work is paused. The
  floor's tools still work." [Update the card]
- At the fair-use line: "New AI work here is paused until (date). This month
  passed the fair-use line in your agreement, which normal use does not reach,
  and Anetix has been told. Your tools keep working."
- Cancelling: "Your subscription ends on (date). After that (Site) goes back to
  being a demo. Everything you built stays, and the floor's password stops
  working." [Keep my subscription]
- Back to demo: "Your subscription ended on (date), so (Site) is a demo again.
  Everything you built is here." [Go live again]

## Build order

Each stage ships and is tested on its own, like the earlier pushes.

1. **The price book and the Sites tab. Built 2026-09-26.** `src/sites.js`
   with the pure parts and their tests (`scripts/test-sites.js`, 95):
   `bandOf({ headcount, sqft }, book)` with its flags, `fairUse`, the stage and
   standing machine `next(state, event)` (every state and event above, and
   every transition that must be refused), the order text and its hash, the
   refundable credit, the pipeline fields. The tables `price_books` and `sites`
   (`orders`, `customers` and `billing_events` arrive with the stage that uses
   them: a table nothing writes to is untested surface). The Sites tab over the
   demos that exist: the price book with a quick quote for calls, the stage
   counts, and the pipeline fields editable per site. Company delete refused
   while a site is activating or subscribed. No Stripe yet. End to end:
   `scripts/e2e/sites.js` (32) and `sites-browser.js` (14).
2. **Go live, as far as Signed. Built 2026-09-26, dark.** The four screens on
   anetix.ai, the draft and its version saved per screen, the approver link,
   the signed order, the site's Stripe Customer, Checkout in setup mode,
   `fulfil()` taught setup mode, and `STRIPE_FAKE` taught setup mode, customers
   and subscriptions. Plus the switch, previews, Withdraw and the Terms of
   Service on Common Paper's standard terms (Stage 2 as built, below).
3. **Activate and the rollover.** The second listener and its key, the three
   Stripe steps with their ids kept on the order, the rollover as one function
   that is safe to run twice, the unused-credit refund, every row of the
   rollover table, the fair-use gate inside `selfserve.assertCredit`, the
   manager's welcome panel, and `requireManager` on every new manager route.
4. **Month to month.** The re-read of every event, the standings, Cancelling,
   the cancel on an unpaid month, Back to demo with the credit epoch, disputes
   and refunds, the portal link, the new Settings sections, the yearly size
   check, and the check against Stripe after a restore.
5. **Enterprise.** Customers with a master agreement, invoice billing
   (`collection_method=send_invoice`, 30 days), New site from the Sites tab,
   copying tools between one customer's sites, one-time invoices for
   integrations and hardware.

The tests that matter most are the races: two people signing one order, two
presses of Activate, a timeout on the subscription step, the first
`invoice.paid` landing before Activate answers, events out of order, an old
subscription's `deleted` after a return, and a restore from before an
activation. Stages 1 to 4 are one customer's whole life. Stage 5 waits for the
first master agreement.

## Stage 2 as built (2026-09-26)

`src/golive.js` and `src/terms.js` here, the go-live pages and routes in the www
repo. It ships **dark**: `platform.settings golive_open` is off until Brendan
switches it on from the Sites tab, whose confirm lists what is still missing
(the terms are draft-1, Activate does not exist yet and a signed site is promised
it is switched on within 24 hours, Large and Very large are proposed prices).
Off, no manager sees Go live and a customer's link is refused. An admin's link
(the Sites tab, 24 hours) works either way.

**The flow.** The board's credit line (Add credit · Go live), the out-of-credit
panel (Add credit, or Go live) and a Settings card carry the manager's link. On
anetix.ai: About your site, Your price, Who signs, Sign; then Stripe Checkout in
setup mode for the site's own Customer; back from Stripe, "Your order is in".
Stripe closed before the card: "One step left: a card", with Add a card (a new
session, the earlier one expired) and, for the manager, Start the order over.
The approver's link opens About the site, The price and Sign on the same order.
Every page and every form comes from the product's view of the order; the band
and price are never the page's.

**What changed from the plan, and why:**

- **The learning opt-in and the billing email are in the signed words.** The
  terms name "the billing email on its order form" as the notice address and
  learning happens "only if Customer opted in on its order form". A tick box
  beside the text (the plan) was outside the hash, so the opt-in moved to screen
  1 and both are lines of the order form.
- **Previews are kept apart.** The adversarial review found that an admin's
  walk-through on a real demo made a real order: it moved the site to Signed with
  a test card on it and showed "Your order is in" to the customer. Now an admin's
  link makes a preview order that never moves the site's stage, never writes to
  its facts, never shows on the customer's board or page, and saves its card to a
  Stripe Customer of its own. An admin's link on the customer's own order is read
  only. A customer's first answer voids an open preview, and anetix.ai detaches
  its card on the spot.
- **Withdraw.** Decline and Send back are stage 3, but a signed order needed a
  way out before then: Withdraw (the site's form on the Sites tab) voids the open
  order with a note. A customer's site goes back to the stage it had before the
  order, and the manager sees the note the next time they open Go live.
- **Cards the product cannot reach.** The product has no line to Stripe. A card
  refused while anetix.ai is in the loop (a second card, a started-over or
  deleted order) is detached at once; one saved on an order withdrawn from the
  Sites tab or a deleted company waits in `orders.stripe.detach_pending`, listed
  on the Sites tab, until stage 3's channel to anetix.ai removes it. Nothing
  charges it.
- **The signer's address.** Express behind a proxy reads the left-most
  X-Forwarded-For, which the sender writes. anetix.ai now records its best guess
  the product's way (Cloudflare's header, then the edge's, then the peer) plus
  the raw evidence (`signed_net`).
- **The terms as signed.** `platform.terms_versions` keeps a version's words at
  its first signature, `/terms/<version>` shows them, and a signature under the
  same version over other words is refused.
- **Price book 1 freezes on the first signed order**, not only on a site past
  ordering (nothing wrote the site's book).
- **The top-up page** no longer takes a card-setup session as its key.
- **Forms carry a token made from the link**, so a page elsewhere, app.anetix.ai
  included, cannot post them with the person's cookie.

**Stage 3 picks up:** Decline and Send back (Withdraw is their plain form now),
removing `detach_pending` cards, the internal channel, Activate.

**Tests.** `scripts/test-golive.js` (52) and `scripts/e2e/golive.js` (99, in
`run-all.sh`) here; in the www repo, `scripts/test-www.js` (74),
`scripts/e2e-golive.js` (55) and `scripts/e2e-golive-browser.js` (26) against
both services in fake Stripe mode.

## Before the first real activation (Brendan, outside the code)

1. **Stripe live:** the Atlas account, live keys on anetix-www, the webhook
   made again in live mode through the API with `api_version=2024-06-20` and the
   new events, and the portal and retry settings above.
2. **Sales tax, decided before the first activation:** Massachusetts taxes SaaS
   as prewritten software at 6.25% (830 CMR 64H.1.3), and working from Boston
   likely gives Anetix nexus there. Ask the accountant. If so, register and
   turn Stripe Tax on first: a subscription made without `automatic_tax` does
   not pick it up when Stripe Tax is turned on later. The site's address goes
   on the Customer as its shipping address (`tax[validate_location]=
   immediately`), so tax follows where the software is used rather than where
   the bill is sent. Registering on MassTaxConnect is free. Returns are yearly
   at $100 of tax a year or less, quarterly up to $1,200, monthly above that,
   each due the 30th of the following month. Stripe Tax's basic plan costs about
   0.5% of what it bills. A Delaware corporation run from Boston also generally
   has to register in Massachusetts as a foreign corporation (a state fee and an
   annual report); Atlas set up Delaware only. Brendan has no accountant yet: an
   hour with a CPA before the first bill settles the nexus call and whether the
   product qualifies for the manufacturing exemption. This is not tax advice.
3. **Counsel:** the Terms of Service the order form points to, the order form
   itself, the learning opt-in wording, and keeping orders after a delete. The
   IP counsel from the patent work is a natural first call. Proposed: build the
   Terms of Service on Common Paper's Cloud Service Agreement (free under CC BY
   4.0, standard terms written by a committee of dozens of attorneys from
   vendors, procurement teams and law firms, laid out as a cover page plus
   standard terms). Our order form becomes its cover page, so counsel reads one
   page and a few choices (the liability cap, the governing law). Stage 2 writes
   the cover page on it.
4. **Anthropic auto reload** on, and the admin credit note saying so (Activate
   checks it).
5. **`WWW_SECRET`** set on anetix-www, and a new `WWW_INTERNAL_KEY` on both
   services.
6. **The tenancy call** at the second paid site: build the runtime per customer
   first, or record why not.

## Open items

1. [INTEGRATION PRICE], from the first measured ERP connection.
2. The square-foot thresholds: 75,000, 150,000, 300,000 and 750,000 proposed.
3. Large and Very large ($3,500 and $5,000) are still proposed.
4. The deck's $30,000 per plant and "3,333 plants" against the new mix.
5. When someone other than the demo's manager signs, whether they also become a
   manager (proposed: no; Add a manager covers it).
6. The terms page is behind the wall like the rest of anetix.ai: the signer, the
   approver and a pin holder can read it, the customer's counsel cannot. Decide
   before switching Go live on whether /terms is public (noindex).
7. The manager's 31-day link is not tied to the account that loaded the board,
   so removing a manager does not kill a link they already have (the credit
   link is the same). Tie it to the account if that matters before launch.
8. Counsel's brackets in `src/terms.js`: governing law, chosen courts, the
   liability caps and covered claims, the notice email, technical support.

## Sources

- BLS, QCEW, number of establishments by size, private industries, March 2026:
  https://www.bls.gov/charts/county-employment-and-wages/establishments-by-size.htm
- DATABASICS, P-card FAQs (per-transaction limits):
  https://blog.data-basics.com/p-card-faqs
- Ramp, corporate card limits by role:
  https://ramp.com/blog/corporate-credit-card-limit-for-employees
- Snohomish County, 2007 Buildable Lands employment density study:
  https://snohomishcountywa.gov/DocumentCenter/View/7660/Employment-Density-Study
- Metropolitan Council, how to measure employment intensity:
  https://metrocouncil.org/Handbook/Files/Resources/Fact-Sheet/ECONOMIC-COMPETITIVENESS/How-to-Measure-Employment-Intensity-and-Capacity.aspx
- Numeral, SaaS sales tax in Massachusetts, 2026:
  https://www.numeral.com/blog/saas-sales-tax-massachusetts
- Stripe: creating a subscription (`payment_behavior`, `off_session`),
  https://docs.stripe.com/api/subscriptions/create ; subscription webhooks and statuses, https://docs.stripe.com/billing/subscriptions/webhooks ;
  customer portal, https://docs.stripe.com/customer-management ; cancellation page,
  https://docs.stripe.com/customer-management/cancellation-page ; Smart Retries,
  https://docs.stripe.com/billing/revenue-recovery/smart-retries ; customer emails,
  https://docs.stripe.com/billing/revenue-recovery/customer-emails ; setup mode,
  https://docs.stripe.com/payments/checkout/save-and-reuse ; the basil period change,
  https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end
- Numeral, Massachusetts sales tax guide (registration, filing frequency, penalties):
  https://www.numeral.com/blog/massachusetts-sales-tax-guide
- Stripe, understanding Stripe Tax pricing:
  https://support.stripe.com/questions/understanding-stripe-tax-pricing
- Common Paper, Cloud Service Agreement (standard terms v2.1, CC BY 4.0):
  https://commonpaper.com/standards/cloud-service-agreement/
- Withum, a Delaware corporation doing business in Massachusetts:
  https://www.withum.com/resources/5-tips-for-business-in-ma-as-a-delaware-corporation/
- Internal: the project docs `claude/pilot-site-unit-economics.md`,
  `claude/business-model-and-use-of-funds.md`, `claude/tam-breakdown.md`,
  `claude/customer-assessments-2026-09-22.md`, `claude/a16z-call-review-2026-09-23.md`;
  `docs/MODEL-ASSESSMENT.md` for Opus 5.5 prices; `src/selfserve.js`,
  `src/agent.js`, `src/credit.js` and `www/stripe.js` as they are on 2026-09-26.
