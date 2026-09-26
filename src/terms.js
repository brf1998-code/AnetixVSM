// The Anetix Terms of Service (2026-09-26, docs/PAID-SITES.md "The order form"). Every site's order form is signed
// under a version of these, and the version and a hash of this document are kept with each signature.
//
// DRAFT FOR COUNSEL. Built on Common Paper's Cloud Service Agreement Standard Terms, Version 2.1 (free to use under
// CC BY 4.0), the way Common Paper lays an agreement out: their Standard Terms, incorporated by reference, and a cover
// page with the Key Terms, the parts of an Order Form that are the same for every site, and the few places Anetix
// works differently from the Standard Terms. Each site's signed order form adds the site, its size, its band and its
// fee. The words in brackets are counsel's to fill in.
//
// Two things in the Standard Terms that Anetix does differently are written as changes here, because the order form
// promises them: a subscription the customer can cancel any time (the Standard Terms renew unless notice comes before
// a Non-Renewal Notice Date, so that date is "any time before the month ends"), and no suspension of the floor's tools
// for a late payment (Brendan, 2026-09-26: billing never takes a floor down by itself).
//
// A word changed here once anyone has signed this version needs a new TERMS_VERSION: a signed order names the
// version, and its terms_sha256 is the hash of these exact words.
const crypto = require("crypto");

const TERMS_VERSION = "draft-1";
const STANDARD_TERMS_URL = "https://commonpaper.com/standards/cloud-service-agreement/2.1";
const LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/";

function termsDoc() {
  return {
    version: TERMS_VERSION,
    title: "Anetix Terms of Service",
    draft: true,
    status: "A draft for counsel, not yet in force. The words in brackets are for counsel to fill in.",
    intro: [
      `The Anetix Terms of Service are the Common Paper Cloud Service Agreement Standard Terms, Version 2.1, posted at ${STANDARD_TERMS_URL} (the Standard Terms), which are incorporated by reference, with the Key Terms, the Order Form terms and the changes on this page.`,
      "Each site's order form, signed on anetix.ai, is an Order Form under these terms. It names the Customer and the Site, and it sets the Site's size, band and fee.",
      "If this page and the Standard Terms disagree, this page controls. If a signed order form and this page disagree, the order form controls.",
    ],
    sections: [
      {
        heading: "Key Terms",
        items: [
          ["Provider", "Anetix, Inc., a Delaware corporation."],
          ["Customer", "the company named on the order form."],
          ["Effective Date", "the day the order form is signed."],
          ["Governing Law", "[GOVERNING LAW]."],
          ["Chosen Courts", "[CHOSEN COURTS]."],
          ["General Cap Amount", "[GENERAL CAP AMOUNT]."],
          ["Increased Claims and Increased Cap Amount", "[INCREASED CLAIMS AND CAP, OR NONE]."],
          ["Unlimited Claims", "[UNLIMITED CLAIMS, OR NONE]."],
          ["Provider Covered Claims and Customer Covered Claims", "[COVERED CLAIMS, OR NONE]."],
          ["Notice Address", "for Anetix, [ANETIX NOTICE EMAIL]; for Customer, the billing email on its order form."],
        ],
      },
      {
        heading: "Order Form terms for every site",
        items: [
          ["Cloud Service", "Anetix for one Site: the improvement board, the tools built on it for the Site, and the AI that builds and changes them."],
          ["Order Date", "the day the order form is signed."],
          ["Subscription Period", "one month. The first one starts on the day Anetix switches the Site on."],
          ["Non-Renewal Notice Date", "any time before the current Subscription Period ends. Customer cancels in the billing portal, and a cancellation takes effect at the end of the month already paid. Partial months are not refunded."],
          ["Fees", "the monthly fee on the order form, set by the Site's band."],
          ["Payment Process", "automatic payment. Anetix charges the card on file through Stripe at the start of each Subscription Period, plus sales tax where it applies."],
          ["Use Limitations", "the fair-use line (change 1 below)."],
          ["Technical Support", "[TECHNICAL SUPPORT]."],
        ],
      },
      {
        heading: "Changes to the Standard Terms",
        list: [
          "Fair use. If Anetix's own AI cost for the Site in a Subscription Period passes the share of that period's fee stated on the order form, new AI work for the Site pauses until the next Subscription Period. The Site's tools keep working.",
          "Late payment. Anetix does not suspend Customer's use of the Site's tools because a payment is late. If a payment has still failed after Stripe's retries, new AI work pauses until it is paid, and Anetix may end the subscription, after which change 3 applies. This replaces suspension for an overdue balance in the Standard Terms; the other reasons for suspension there still apply.",
          "After the subscription ends. When the last paid Subscription Period ends, the Site becomes a demo account for Customer's manager and the floor's access closes. Customer's data is kept until Customer asks for its deletion, or until 12 months pass with no sign-in, and Anetix deletes it within 60 days of a request.",
          "Price. Anetix will not raise the Site's fee while the subscription continues, except to move the Site up a band when its stated size grows. Customer confirms the Site's size once a year, and the band only moves up.",
          "Learning. Anetix learns from how the Site uses the system, to improve Anetix for all customers, only if Customer opted in on its order form. Customer can change that choice at any time by telling Anetix. Customer's data is never shown to another customer.",
          "Unused demo credit. Credit Customer bought for its demo and has not used by the day the Site is switched on comes off the first bill, at the price Customer paid for it.",
        ],
      },
    ],
    footer: `The Standard Terms are Common Paper's, free to use under CC BY 4.0 (${LICENSE_URL}). This page is Anetix's cover page to them.`,
    links: { standard_terms: STANDARD_TERMS_URL, license: LICENSE_URL },
  };
}

// The document as plain text, the words the hash is taken over. Pure.
function termsText(doc = termsDoc()) {
  const out = [doc.title, `Version ${doc.version}.`, doc.status, "", ...doc.intro, ""];
  for (const s of doc.sections) {
    out.push(s.heading);
    if (s.items) for (const [k, v] of s.items) out.push(`${k}: ${v}`);
    if (s.list) s.list.forEach((x, i) => out.push(`${i + 1}. ${x}`));
    out.push("");
  }
  out.push(doc.footer);
  return out.join("\n");
}
const termsHash = () => crypto.createHash("sha256").update(termsText(), "utf8").digest("hex");

module.exports = { TERMS_VERSION, STANDARD_TERMS_URL, LICENSE_URL, termsDoc, termsText, termsHash };
