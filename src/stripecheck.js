// The product reads a refill's Stripe session itself before it adds bought credit (the launch audit 3.7, 2026-09-28).
//
// Until now POST /api/www/credit added credit on anetix.ai's word under the one shared key (SOS_WWW_KEY): whoever
// held that key could add any amount to any company. The product still never holds a key that can charge anyone.
// STRIPE_READ_KEY is a Stripe restricted key with one permission, Checkout Sessions: Read (rk_live_... on the live
// instance). With it set, a refill is added only when Stripe itself says that session:
//   - is a payment, complete and paid;
//   - is a refill (metadata.kind "topup") for THIS company (metadata.slug);
//   - was for the dollars anetix.ai says were paid (amount_total), and names the credit anetix.ai says to add
//     (metadata.credit_usd), which is never more than the dollars paid.
// Anything else is refused (403, code "unverified") and never added. Stripe out of reach is a 503: anetix.ai's page
// says to try again, Stripe sends its webhook again, and anetix.ai's reconcile (3.6) asks again later.
// Without the variable a refill is taken on anetix.ai's word as before, and the Sites tab and the boot log say so.
// STRIPE_API_BASE points the check at anetix.ai's fake Stripe in tests; never set it on Railway.
const KEY = () => String(process.env.STRIPE_READ_KEY || "");
const BASE = () => String(process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/+$/, "");
const money = (x) => Math.round(Number(x || 0) * 100) / 100;

// "live" | "test" | "none" | "unknown": which Stripe the key reads (the Sites tab puts it beside anetix.ai's own mode)
function mode() { const k = KEY(); return !k ? "none" : /^rk_live_|^sk_live_/.test(k) ? "live" : /^rk_test_|^sk_test_/.test(k) ? "test" : "unknown"; }
const on = () => Boolean(KEY());

// Pure: does this session back a refill of credit_usd for paid_usd to slug? -> null (it does) or the reason it does not
function judge(s, { slug, paid_usd, credit_usd }) {
  if (!s) return "Stripe has no such session";
  const m = s.metadata || {};
  if (s.mode !== "payment") return "it is not a payment";
  if (s.status !== "complete" || s.payment_status !== "paid") return "it is not paid";
  if (m.kind !== "topup") return "it is not a refill";
  if (String(m.slug || "").toLowerCase() !== String(slug || "").toLowerCase()) return "it is for another company";
  const paid = money(Number(s.amount_total || 0) / 100);
  if (paid !== money(paid_usd)) return `it was for $${paid}, not $${money(paid_usd)}`;
  if (money(m.credit_usd) !== money(credit_usd)) return "the credit asked for is not the credit on the session";
  if (!(money(credit_usd) > 0) || money(credit_usd) > paid) return "the credit is more than was paid";
  return null;
}

async function session(id) {
  if (!/^cs_[A-Za-z0-9_]{6,255}$/.test(String(id || ""))) return null;
  let res;
  try { res = await fetch(`${BASE()}/v1/checkout/sessions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${KEY()}`, "Stripe-Version": "2024-06-20" }, signal: AbortSignal.timeout(10000) }); }
  catch (e) { throw Object.assign(new Error("Stripe could not be reached to check the payment. Try again in a minute."), { status: 503, code: "stripe_unreachable" }); }
  if (res.status === 404) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[stripecheck] Stripe answered ${res.status} for ${id}: ${(j.error && j.error.message) || ""}`.slice(0, 300));
    throw Object.assign(new Error("Stripe could not be asked about the payment just now. Try again in a minute."), { status: 503, code: "stripe_unreachable" });
  }
  return j;
}

// Throws (403 unverified, 503 unreachable) unless Stripe backs the refill. Without the key: nothing to check.
async function verifyTopup({ ref, slug, paid_usd, credit_usd }) {
  if (!on()) return { checked: false };
  const why = judge(await session(ref), { slug, paid_usd, credit_usd });
  if (why) {
    console.error(`[stripecheck] refill for ${slug} refused (${ref}): ${why}`);
    try { require("./notify").notifyEvery(`stripecheck:${slug}`, 30 * 60e3, "A refill did not check out with Stripe", `A refill for ${slug} was refused because ${why}. Nothing was added. Read the deploy log and the payment in Stripe.`, { priority: 4, tags: ["warning"] }); } catch (e) { /* never from here */ }
    throw Object.assign(new Error(`That payment could not be matched in Stripe (${why}), so no credit was added.`), { status: 403, code: "unverified" });
  }
  return { checked: true };
}

function bootLine() {
  console.log(on() ? `[stripecheck] a refill is added only when Stripe (${mode()}) backs it` : "[stripecheck] STRIPE_READ_KEY is not set: a refill is added on anetix.ai's word (the launch audit 3.7)");
}

module.exports = { judge, verifyTopup, session, mode, on, bootLine };
