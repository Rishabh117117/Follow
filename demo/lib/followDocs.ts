/* =========================================================================
   Follow — uploaded files (D-02 product replica).
   The 7 documents captured this week, in the markdown subset the reader
   renders: "## " / "### " headings, "- " bullets, "**bold**", "> " pull
   quotes, and blank-line paragraphs. No tables, links, or code fences.

   HONESTY: sample data written for the sandbox, consistent with the 20
   canonical memory entries in lib/followSandbox.ts. The shipped Follow
   product captures real AI threads over MCP.
   ========================================================================= */

import type { FDoc } from "./followProduct";

export const F_DOCS: FDoc[] = [
  {
    id: "doc-1",
    title: "Aurora Checkout — PRD v2.1",
    filename: "aurora-checkout-prd-v2-1.md",
    kind: "prd",
    uploaderId: "alex",
    when: "Mon",
    seq: 1,
    sizeKb: 34,
    topics: ["planning", "design", "payments"],
    summary: "Goals, requirements, and launch scope for the checkout relaunch — EU+US together, SCA-ready, promo codes stay visible.",
    producedEntryIds: ["fd1", "fd2"],
    body: `## Aurora Checkout — PRD v2.1

**Owner:** Alex · Product
**Status:** Approved for Sprint 1
**Last updated:** this sprint, Monday

This is the v2.1 revision of the checkout redesign PRD, folding in feedback from last week's stakeholder review. The core shape hasn't changed: we are replacing the v1 checkout flow end to end, not patching it.

### Goals

- Cut checkout abandonment measurably within one quarter of launch.
- Bring the flow up to WCAG 2.2 AA — checkout is a relaunch blocker category, not a nice-to-have.
- Ship a payments foundation that doesn't need another rebuild in 18 months.

### Non-goals

- We are not redesigning the cart page in this cycle (shipping-estimate placement is tracked separately).
- We are not adding new payment methods beyond cards and the major wallets at launch.

### Launch scope

**EU and US storefronts relaunch together.** This was debated in the last planning cycle and the decision is now final: staggering the two markets adds coordination overhead without a clear upside, and marketing has already committed a joint launch date externally. That means checkout ships **localized in English, German, and French from day one**, and — because the EU leg is in scope — **SCA-ready payments from day one** as well. Anything that only half-supports SCA is not shippable; see the compliance checklist for the detailed requirements once Sam's readiness pass lands.

### Requirements

1. Guest and account paths both supported (design is still finalizing which is default — tracked as an open decision, not blocking this PRD).
2. Card entry via the processor's hosted fields (carried over from the v1 postmortem's hard lesson — see that doc for the incident history).
3. Promo-code entry stays visible at checkout, not tucked behind a link. **Merchandising has committed to code-led campaigns for Q3** and needs the field prominent for that program to land its numbers. This is a hard requirement from that team, not a design preference, and it should be treated as a constraint on the redesign rather than a starting point up for revisiting mid-sprint.
4. Mobile-first layout — engineering's early funnel read shows mobile traffic dominates checkout sessions, so this isn't optional polish.
5. Shipping cost visible before the final payment step (exact placement TBD, see the funnel analysis for why this matters more than it sounds).

### Assumptions (unvalidated)

These are working numbers used to scope the payments track. None of them have been independently verified yet and they should not be treated as facts until someone runs the check:

- **Processing volume is assumed at roughly $2M/yr.** This number came from an old finance slide and hasn't been reconciled against actual gateway statements this cycle. It matters because processor pricing models (blended vs. interchange-plus) cross over at different breakpoints depending on volume, and picking the wrong side of that line has real cost implications. Whoever picks up the processor cost model should confirm this figure against real statements before committing to a switch.
- Average order value is assumed flat month over month; seasonality hasn't been modeled.
- We're assuming current payment method mix holds post-relaunch (no shift toward wallets assumed, even though UX intends to promote them more prominently).

### Open questions

- Guest-vs-account default: design and growth have different priors here; needs a decision this sprint.
- Final promo-code visual treatment: visible-but-secondary vs. fully prominent, pending the usability round.

### Action items

- Sam: confirm PCI scope implications of the hosted-fields requirement.
- Maya: usability test round 1 on guest checkout, this week.
- Alex: pull real May funnel numbers to replace assumption-based estimates.`,
  },
  {
    id: "doc-2",
    title: "Checkout v1 postmortem (2024)",
    filename: "checkout-v1-postmortem-2024.md",
    kind: "postmortem",
    uploaderId: "sam",
    when: "Mon",
    seq: 2,
    sizeKb: 28,
    topics: ["payments", "design"],
    summary: "What broke in v1 — hand-rolled card fields drove most incidents; the promo box quietly leaked abandons.",
    producedEntryIds: ["fd3", "fd4"],
    body: `## Checkout v1 postmortem (2024)

**Owner:** Sam · Engineering
**Scope:** Everything that went wrong in the original checkout build, written up ahead of the v2 kickoff so we don't repeat it.

This postmortem exists because v2 planning kept surfacing the same question in different words: "didn't we already learn this?" The answer is usually yes. This is the consolidated version.

### Timeline

v1 checkout shipped and ran in production for roughly a year. Incident volume against the checkout surface was disproportionate to its size relative to the rest of the site, and by the time the redesign was greenlit, checkout had become the single most-paged-on flow in the product.

### What went wrong

**Card field handling.** The single largest driver of checkout incidents was our own card input implementation. We built and maintained hand-rolled card fields — custom formatting, custom validation, custom error states, the works — instead of using the processor's hosted fields. In hindsight this was the wrong tradeoff. **Hand-rolled card fields caused 60% of checkout incidents** logged against this surface over the year: validation edge cases, browser autofill conflicts, and PCI-scope creep every time someone touched the input logic. Hosted fields exist specifically to take this class of problem off our plate, and v1 declined to use them to save a few days of integration work up front. That decision cost far more than it saved.

> "We kept fixing the same three bugs in card validation, over and over, in three different frameworks, for a year." — incident retro notes, Q3

**Promo-code placement.** The second theme is subtler and took longer to notice because it doesn't show up as an incident — it shows up as a silent conversion leak. The promo-code entry field sat prominently at the top of the payment step. Session recordings and funnel data both point to the same behavior: users would focus the promo field, presumably to check if they had a discount available or to go looking for one, and a meaningful share of them never came back. **Fourteen percent of abandons followed a promo-field focus event** — meaning roughly one in seven checkout abandonments in v1 can be traced to a user interacting with the promo box and then leaving, likely to go compare-shop for a better code or a better price elsewhere. The field invited comparison-shopping exits at exactly the moment we most needed the user to stay.

**Recommendation for v2:** hide the promo-code box behind a link ("Have a promo code?") rather than surfacing an open text field by default. This keeps the functionality available for users who already have a code without inviting the browse-away behavior for users who don't.

### Other findings (lower severity)

- Error messaging was toast-only in several steps, which caused its own support volume (tracked separately, feeds into the a11y audit).
- The address step was fully client-rendered and was a meaningful chunk of the JS bundle relative to its complexity.

### Action items

- v2 must use the processor's hosted fields for all card input. Non-negotiable given the incident history above.
- v2 should reconsider promo-code default visibility. Flagging this explicitly for the PRD review, since the current draft has it visible by default — worth a conversation before that's locked in.
- Toast-only errors should not carry forward into v2's a11y work.`,
  },
  {
    id: "doc-3",
    title: "Checkout usability test — round 1 notes (n=6)",
    filename: "checkout-usability-round-1-notes.md",
    kind: "research",
    uploaderId: "maya",
    when: "Tue",
    seq: 6,
    sizeKb: 22,
    topics: ["guest-checkout", "accessibility"],
    summary: "Six participants, moderated sessions — guest checkout and toast-only errors both surfaced as hard blockers.",
    producedEntryIds: ["fd5", "fd6"],
    body: `## Checkout usability test — round 1 notes (n=6)

**Facilitator:** Maya · Design
**Method:** Moderated remote sessions, think-aloud, task-based
**Participants:** 6 (P1–P6), mixed device: 4 mobile, 2 desktop; 2 participants use screen readers as their primary assistive technology (P4, P6)

### Tasks

1. Add an item to cart and complete checkout as a first-time visitor.
2. Locate and apply a promo code.
3. Recover from a deliberately triggered card-validation error.

### Findings

**Guest checkout.** This was the single clearest signal out of round 1. **Five of the six participants attempted to check out without creating an account** — they either looked for a "guest" option unprompted or simply tried to proceed past the account step assuming it was optional, and were visibly surprised when it wasn't. Two of them, P2 and P5, described the forced sign-up as a dealbreaker without being asked a leading question about it — the word came from them, not from the moderator.

> "I just want to buy the thing. Why do I need an account for that?" — P2

> "If this made me sign up on my phone right now I'd probably just close the tab." — P5

Only P3 proactively wanted an account, and that was specifically because they mentioned expecting to order from us again.

**Toast-only errors.** The second major finding concerns the card-step error state, and it lines up cleanly with a known issue from the v1 postmortem. When we triggered a validation error on the card number field, **both screen-reader participants (P4, P6) missed it entirely.** The error was communicated via a toast notification that appeared and auto-dismissed near the top of the viewport, with no inline text next to the field itself and no live-region announcement. Neither P4 nor P6 could complete the card step unaided — both eventually asked the moderator what was wrong, which in a real unmoderated session would simply be an abandonment.

> "I heard nothing. I didn't know anything happened until you told me." — P4, on the card error

This is a direct repeat of the toast-only error pattern flagged in the v1 postmortem's "other findings" section, now confirmed with real participants rather than inferred from support tickets.

### Secondary observations

- Promo-code discovery wasn't a major friction point in this round — participants who wanted to use a code found the field without difficulty. Worth revisiting once the box's default visibility changes.
- Mobile participants in particular struggled with the length of the address form; this is being tracked against the performance and field-count work happening in parallel.
- No participant explicitly commented on visual density, but three mobile participants needed to scroll to see the full payment step, which is a data point for the compact layout work.

### Recommendations

1. Guest checkout should be the default path, with account creation offered after order confirmation rather than before purchase.
2. Card errors need an inline treatment tied to the field plus an aria-live announcement — toast-only is not sufficient and this is now confirmed with two independent assistive-technology users, not just inferred from logs.
3. Round 2 should specifically test the guest-to-account-creation handoff once that flow exists, to make sure the deferred signup doesn't get lost.

### Next steps

Round 2 scheduled for next sprint, contingent on the guest-checkout decision landing first so we're testing the real flow rather than a mockup.`,
  },
  {
    id: "doc-4",
    title: "May checkout funnel — analytics export",
    filename: "may-checkout-funnel-analytics-export.md",
    kind: "analysis",
    uploaderId: "alex",
    when: "Tue",
    seq: 7,
    sizeKb: 19,
    topics: ["analytics"],
    summary: "Stage-by-stage funnel for May — mobile conversion trails desktop badly, and shipping cost is the biggest single leak.",
    producedEntryIds: ["fd7", "fd8"],
    body: `## May checkout funnel — analytics export

**Owner:** Alex · Product
**Period:** May, full month
**Source:** Checkout funnel event stream, stage-by-stage completion

Pulling this together to replace the assumption-driven numbers in the PRD with something real. This is the raw export plus notes — the sprint-plan implications get worked out separately once the team has seen the actual shape of the funnel.

### Stage-by-stage completion

Checkout is instrumented at five stages: cart → shipping info → shipping-cost reveal → payment info → confirmation. May's data shows the drop-off is not evenly spread across those stages — it's heavily concentrated in one place.

**The shipping-cost reveal stage is where the funnel breaks.** Of sessions that reach that stage, **41% do not continue past it.** That is, by a wide margin, the single largest stage-to-stage drop in the entire funnel — bigger than the payment step, bigger than the initial cart-to-checkout transition. Users get all the way through entering their shipping information, see the total cost for the first time including shipping, and a huge share of them simply leave. This reads as a pricing-surprise problem, not a friction or usability problem — the users who leave here have already done the harder work of filling in their address.

### Device split

**71% of all checkout sessions in May were on mobile.** This is now the dominant device for checkout, not a secondary consideration, and it changes how we should weigh every downstream decision about form length and field count.

Conversion rate by device tells the more urgent story:

- Desktop: 4.3% conversion (checkout-started to order-completed)
- Mobile: 1.8% conversion

That gap — desktop converting at roughly two and a half times the mobile rate — represents the single biggest revenue lever available in the entire checkout surface. Mobile isn't just the majority of traffic, it's converting at a fraction of the rate desktop does, and closing even part of that gap moves more revenue than any other change under discussion this sprint.

### Field-count sensitivity

Cross-referencing session replay data against form abandonment: on mobile, every additional required form field on the shipping and payment steps correlates with a measurably larger completion drop than the same field costs on desktop. We don't have a clean causal isolate for this yet (it's correlational, pulled from stepwise field-removal A/B tests run last quarter on an adjacent flow), but the direction is consistent enough across three separate tests that it should inform the field-count decisions on the new form: every field we can cut or defer matters more on mobile than the equivalent decision does on desktop.

### Cohort notes

- New vs. returning: returning users convert roughly 1.6× the rate of new users across both devices, consistent with prior months — no May-specific anomaly here.
- No meaningful weekday/weekend split observed.
- The 41% shipping-reveal drop is stable week over week within May, not a single anomalous week skewing the monthly average.

### Recommendations for the sprint

1. Move the shipping-cost estimate earlier in the flow — ideally onto the cart page, before the user has invested effort in the address form — so the reveal stage stops being a surprise.
2. Treat mobile field-count reduction as a priority, not a polish pass, given the device split above.
3. Any funnel experiment this sprint should be powered against the mobile segment specifically, since that's where both the volume and the opportunity live.

### Appendix

Raw stage counts and the underlying event query are available on request — this export is the summarized version for planning purposes.`,
  },
  {
    id: "doc-5",
    title: "PCI-DSS SAQ-A + SCA readiness checklist",
    filename: "pci-dss-saqa-sca-readiness-checklist.md",
    kind: "notes",
    uploaderId: "sam",
    when: "Wed",
    seq: 11,
    sizeKb: 15,
    topics: ["compliance", "payments"],
    summary: "Compliance scope check for v2 — staying on SAQ-A hinges entirely on keeping card input fully hosted.",
    producedEntryIds: ["fd9"],
    body: `## PCI-DSS SAQ-A + SCA readiness checklist

**Owner:** Sam · Engineering
**Purpose:** Confirm what compliance scope v2 lands in before we write a line of payment-step code, since the wrong scope is expensive to walk back.

This is a working checklist, not a final audit. Legal/compliance will do a formal review before launch, but engineering needs to know the target scope now so the architecture doesn't paint us into a corner.

### Why this matters now

The PRD assumes v2 stays in the lightest PCI compliance tier (SAQ-A). That assumption is only true under a specific architectural condition, and it's worth spelling out explicitly before anyone builds a card input component that violates it.

### SAQ-A eligibility

**SAQ-A eligibility requires hosted payment fields end-to-end.** That means card data must never touch our servers or our client-side code in any form — the processor's hosted iframe or hosted fields library handles the entire card-entry surface, and our code only ever sees a token back. This lines up with the v1 postmortem's hosted-fields recommendation for reliability reasons, and it turns out to also be load-bearing for compliance scope, which raises the stakes on that decision considerably.

**If we introduce any custom card input** — even something that looks minor, like a custom-styled wrapper that touches raw card data before handing it to the processor, or a "smart" card-number formatter that reads the field value directly — **we lose SAQ-A eligibility and move to SAQ A-EP.** SAQ A-EP is a materially heavier compliance tier: it requires **quarterly ASV (Approved Scanning Vendor) scans** of the relevant infrastructure, a larger set of controls to document and maintain, and meaningfully more overhead on every future payments-adjacent change. This is not a one-time cost — it's an ongoing quarterly obligation for as long as we stay in that tier.

### Checklist status

- [x] Card number, expiry, CVV entry via processor-hosted fields — **pass**, confirmed with the current integration plan.
- [x] No card data logged anywhere in application logs — **pass**, verified against the current logging config.
- [ ] Confirm the wallet integrations (Apple Pay / Google Pay) don't introduce a scope exception — **todo**, needs a check against processor documentation.
- [ ] Formal SAQ-A self-assessment submission — **todo**, blocked on final integration being code-complete.
- [x] SCA / 3DS2 handled via the processor's native challenge flow, not a custom retry implementation — **pass**, consistent with the Stripe API findings from earlier this week.

### SCA readiness

Separately from PCI scope: the EU relaunch requires PSD2/SCA compliance, which means 3DS2 challenge flows need to be functional at launch, not added later. This is being tracked as its own workstream but is closely related — both hinge on using the processor's native flows rather than rolling anything custom.

### Risks if scope slips to SAQ A-EP

- Quarterly ASV scans become a recurring engineering-calendar item, not a one-time launch task.
- Any future contractor or vendor touching the payment step needs a heavier security review.
- Time-to-ship for future payment-adjacent features goes up, since every change needs to be evaluated against the wider control set.

### Recommendation

Treat "no custom card input, ever" as a hard architectural constraint on the payment step, not a preference. It's cheaper to enforce this with a lint rule or a code-review checklist item than to discover a violation after a component has already shipped.`,
  },
  {
    id: "doc-6",
    title: "Support tickets — checkout themes, May",
    filename: "support-tickets-checkout-themes-may.md",
    kind: "notes",
    uploaderId: "alex",
    when: "Wed",
    seq: 12,
    sizeKb: 13,
    topics: ["analytics"],
    summary: "Zendesk theme breakdown for checkout-adjacent tickets — confirmation-email confusion dominates by a wide margin.",
    producedEntryIds: ["fd12"],
    body: `## Support tickets — checkout themes, May

**Owner:** Alex · Product
**Source:** Zendesk, tickets tagged checkout-adjacent, May 1–31
**Total tickets in scope:** a little over 400

Pulling this to make sure the redesign addresses what's actually generating support volume, not just what's visible in funnel analytics. Some of these themes won't show up as funnel drop-off at all because the user *did* complete checkout — they just didn't trust that they had.

### Theme breakdown

1. **"Where's my confirmation email?" — 31%.** This is the largest single theme by a wide margin, more than double the next category. These are tickets from customers who completed an order, did not receive (or could not find) a confirmation email in a timeframe that felt reasonable to them, and reached out anxious that the order hadn't gone through or that they'd been charged without a corresponding order. In many of these cases the email did eventually arrive, or was in spam, or the order was genuinely fine — the ticket exists because the checkout experience gave the customer no confirmation *at the moment of completion* that clearly said "your email is on its way." The confirmation screen currently just says "Order placed" with an order number; it does not reference email at all.
2. Card decline / payment error confusion — 18%. Adjacent to the a11y and error-messaging work already in flight.
3. Promo code not applying — 12%. Worth watching once promo-box visibility changes; could shift in either direction.
4. Shipping cost / address issues — 11%.
5. Guest order lookup ("I checked out as a guest, how do I find my order?") — 9%.
6. All other themes, individually under 5% each — 19% combined.

### The confirmation-email theme, in detail

Digging into a sample of the 31%, a consistent pattern emerges: customers are not confused about *whether* they'll get an email eventually — they're anxious about it in the seconds and minutes right after completing checkout, when the confirmation screen is the only thing in front of them and it says nothing about email at all. Several tickets include phrasing close to "did this even go through," despite the order existing correctly in our system at the time they wrote in.

> "The order page just said 'placed' and then nothing. I didn't know if I should try again." — paraphrased from a representative ticket

This is a confirmation-screen design gap, not a deliverability problem — our email deliverability metrics for order confirmations are healthy and unrelated to this ticket volume.

### Recommendation

The confirmation screen needs an **explicit email-sent state** — a visible line confirming that a confirmation email has been sent to the address on file, ideally with the masked email address shown so the customer can self-verify they typed it correctly. This is a small addition relative to the ticket volume it's likely to address, and it doesn't require any backend change since the email is already being sent reliably today — the gap is purely that the UI never says so.

### Secondary notes

- Card decline confusion (theme 2) is being addressed separately via the inline-error and a11y work already scoped.
- Promo code ticket volume (theme 3) should be re-measured after the promo-box visibility decision lands, since it may move meaningfully in either direction depending on which way that goes.

### Action items

- Add an explicit "confirmation email sent to [masked address]" line to the order-confirmation screen. Low effort, addresses the largest single ticket theme.
- Re-pull this report one month post-launch to see whether the new confirmation state moved the theme-1 percentage.`,
  },
  {
    id: "doc-7",
    title: "Payment sheet v3 — design spec",
    filename: "payment-sheet-v3-design-spec.md",
    kind: "spec",
    uploaderId: "maya",
    when: "Thu",
    seq: 17,
    sizeKb: 26,
    topics: ["design", "accessibility"],
    summary: "Component-by-component spec for the new payment sheet — compact single-column layout with inline, announced errors.",
    producedEntryIds: ["fd10", "fd11"],
    body: `## Payment sheet v3 — design spec

**Owner:** Maya · Design
**Status:** Ready for engineering handoff
**Related:** follows directly from this week's visual pass and the accessibility audit findings

This is the component-level spec for the redesigned payment sheet — the card-entry and review surface that replaces v1's payment step. It assumes the hosted-fields requirement from the postmortem and compliance checklist as a given; this spec covers everything around those hosted fields.

### Layout

**Single-column layout throughout.** No side-by-side field pairs, even on desktop. This was a deliberate simplification from earlier drafts that used a two-column layout for smaller fields like expiry and CVV — testing and the visual pass both pointed toward single-column reading more clearly as one linear task, which matters more here than the vertical space it costs.

**Grid: 4px base unit.** All spacing in the payment sheet — field gaps, internal padding, margins between sections — resolves to multiples of 4px. This is the same compact density scale adopted in this week's visual pass, not a payment-sheet-specific choice.

**Labels: 13px.** Field labels use the compact 13px size rather than the previous 15px, consistent with tightening the whole sheet's density. Body/input text stays at the standard readable size — only labels moved down.

**Token sync: design-tokens v2.3, compact scale.** Every spacing and type value in this spec resolves to a token from the v2.3 compact set rather than a hardcoded value, so future density or spacing changes propagate from the token file rather than requiring a spec rewrite. Engineering should flag anything in this spec that doesn't map cleanly to an existing v2.3 token rather than inventing a one-off value.

### Component breakdown

**Card number field.** Hosted-fields iframe, full width, single line. Placeholder shows a generic card-number format hint, not a live example number.

**Expiry + CVV.** Despite being visually smaller fields, these stay in the single-column stack rather than sharing a row — see layout note above.

**Cardholder name.** Standard text input, full width, above the hosted card-number field.

**Billing address toggle.** Defaults to "same as shipping" checked; unchecking reveals a standard address sub-form using the same field components as the shipping step.

**Review summary.** A collapsed line-item summary sits above the submit button, expandable, so the user can double check the total (including shipping, per this week's shipping-visibility work) without leaving the payment step.

### Error handling

This is the section that most directly answers the accessibility audit's findings. **The sheet bakes in an inline-error pattern as the only error treatment** — there is no toast-based error state anywhere in this spec, which is a deliberate departure from v1's approach given what the usability round and the audit both surfaced about toast-only errors being effectively invisible to screen-reader users.

Concretely: **every field-level error is tied to its field via aria-describedby**, so assistive technology announces the error in context when the user reaches or re-focuses that field, and **the sheet additionally uses an aria-live region to announce validation errors as they occur**, so a screen-reader user doesn't have to tab back to a field to discover something went wrong. Visually, the error text renders directly beneath its field in the error-red token, with the field's border picking up the same color — the announcement and the visual treatment are two views of one underlying error state, not two separate systems.

### States

- Default / empty
- Focused
- Filled + valid
- Error (inline text + aria-describedby + aria-live announce, per above)
- Submitting (button loading state, fields disabled)
- Hosted-field-specific: the iframe's own internal states are outside this spec's control and are documented separately by the processor.

### Handoff notes

- All spacing values reference v2.3 compact tokens by name in the attached token map (not included in this body — engineering has the token file).
- Error copy strings are being finalized separately with content design; placeholder copy in the mockups is not final.
- This spec assumes the guest-checkout decision holds, since it doesn't include an account-creation step within the sheet itself.`,
  },
];
