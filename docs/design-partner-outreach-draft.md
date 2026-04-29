# Design Partner Outreach - Cold Email Draft

**Purpose:** First design partner conversation for Allocus. Drafted 2026-04-29 for use in Month 4 (August 2026) per build spec roadmap, or earlier if opportunity arises.

**Status:** Draft - do not send yet. Send only after Month 1-2 work is shipped (you need something to show beyond the landing page).

---

## Target profile

**Firm characteristics:**
- $500M-$2B AUM mid-market PE/infra/credit fund
- Currently raising next vintage (Fund III, IV, V)
- Behind their original target close timeline (in market 12+ months)
- IR team of 1-3 people

**Person characteristics:**
- Title: Director of Investor Relations / Head of Capital Formation / VP IR
- Tenure: 2-5 years at the firm (long enough to have credibility, short enough to be open to new tools)
- Indicator they're feeling pressure: posted on LinkedIn about fundraising, attended conferences in the last 6 months, follow LP-side accounts

**How to find them:**
1. PEI / PEI fundraising tracker - lists firms currently raising
2. Pensions & Investments quarterly fundraising scorecards
3. SEC EDGAR Form D filings (search "private fund" filings, sort by date)
4. LinkedIn search: "Investor Relations" + "Private Equity" filtered to mid-size firms
5. Conferences attended: SuperReturn, IPEM, PEI Operating Partners

---

## The email

**Subject line options (test variations):**
- A: Quick question on pension research workflow
- B: 10 hours/week question for [Firm Name]'s IR team
- C: Built something for IR teams - 30 min to show you?

Recommendation: Start with Option A. Curiosity-driven, not pitch-y.

**Body:**

Hi [Name],

I built a tool that monitors public pension allocation activity in real time, designed to help mid-market IR teams know which LPs to call and when. Wanted to see if it might be useful for [Firm Name].

The premise: instead of manually scanning pension board minutes, CAFRs, and consultant searches for commitment signals, the tool does it daily across 20+ plans (growing to 50 by August), predicts which plans will allocate to your asset class in the next 6 months based on documented pacing and unfunded budget, and surfaces the right contact at each plan (consultant, board chair, asset class head).

For first design partners, I'm offering 6 months of free access in exchange for 30 minutes a month of feedback. No commitment beyond that.

Worth a 20-minute call to show you the predictive page?

Vitek Vrana
allocus.com

---

**Length:** ~150 words. Short on purpose.

**Tone notes:**
- "Built a tool" not "I'm excited to introduce" - peer-level, not vendor pitch
- Specific numbers (20+, 50, 6 months, 30 minutes, 20-minute) - signals operator mindset
- "Worth a 20-minute call" not "Would you like to see a demo" - assumes value, leaves out
- No links beyond domain - keeps the email simple
- No bcc, no formatting tricks - looks like a normal email

**What you're testing:**
The email works if it gets you a call from someone who fits the target profile. Doesn't matter how many opens or replies in aggregate - matters whether one good fit converts.

---

## Follow-up sequence

If no reply after 7 days, send this short follow-up:

Hi [Name], following up on the note below. If LP intelligence isn't a priority right now or my read on [Firm Name]'s fundraising needs is off, no problem - feel free to ignore.

Vitek

If no reply after 21 days: stop. Move to next prospect.

**Total touch budget per prospect: 2 emails over 3 weeks. Then move on.**

---

## What "yes" looks like

A response like:
- "Send me a demo link"
- "When are you available?"
- "Send me more info"
- "What asset classes do you cover?"

Response handling:

**For "send me a demo":** Reply with calendar link. Schedule 30 minutes. Show the predictive page (Month 2 deliverable). Don't show the full codebase, audit docs, or marketing content. Show what they care about: a list of plans they should call ranked by probability of commitment.

**For "send me more info":** Reply with allocus.com URL plus a one-page PDF (you'll need to create this). Don't reply with a long email - they'll skim it.

**For "what asset classes":** Be direct. Today: PE, infra, credit, RE. Tomorrow: same plus venture. If their fund is something we don't cover, say so honestly.

---

## What "no" looks like

A response like:
- "Not interested"
- No reply after 21 days
- "We use Preqin"
- "We're not raising right now"

Response handling:

**For "not interested":** Reply with one line: "Got it - thanks for the reply. If anything changes, you know where to find me." Don't push, don't argue, don't try to convert. Move on.

**For "we use Preqin":** Reply: "Makes sense. Allocus is built for the workflow Preqin doesn't cover - daily commitment signal and predictive ranking. If you ever want to compare on a specific use case, happy to show. Otherwise, all good." This isn't pushy, just plants a seed.

**For "we're not raising right now":** Reply: "Fair point. Mind if I check back in 6 months?" Then check back in 6 months.

---

## What to learn from each conversation

Even rejections teach you. Track in docs/design-partner-outreach-log.md with these columns: Date, Firm, Person, Channel, Outcome, What we learned.

Specifically watch for:
- Are people responding to the asset-class focus? Or do they want broader coverage?
- Is the predictive layer the hook, or is it the unfunded-budget metric?
- Are mid-market firms the right segment, or should we also target placement agents?
- What's the actual price ceiling? (When you eventually pitch paid pricing, do they balk at $15k or are they fine with it?)
- Is "free design partner" too good to be true (red flag) or just right?

---

## When to start sending

Per the build spec, design partner outreach is Month 4 (August 2026). Don't send before then unless:

- You have a working predictive page (Month 2 deliverable shipped)
- You have at least 30 plans live (Month 3 deliverable shipped)
- The product can stand up to a 20-minute demo

Sending before product is ready burns prospects. The IR people you target are not patient - they'll evaluate your pitch on the first 30 seconds of demo. If you show them a half-built tool, they'll mark you as "founder who wasn't ready" and remember it.

Better to wait 4 months and pitch when the product is real than send now and burn the relationship.

---

## How many to send

When the time comes:
- Week 1: 5 prospects, hand-picked from research
- Week 2: 5 more, refining the message based on Week 1 responses
- Week 3-4: 10-15 more, scaling once message is dialed in

Total budget: 25-30 prospects in Month 4. Goal: 1-2 design partners signed.

A 5-10% conversion from cold email to signed design partner is realistic for a tool like this. If you go below 5%, the message is wrong. If you go above 15%, you're either getting lucky or under-reading the responses.

---

## What to never do in design partner outreach

- Send a generic "I'd love to learn more about your firm" email (vendor-pitch energy)
- Ask for an NDA before showing demo (they'll never sign one)
- Send a 30-slide deck (no one reads them)
- Promise specific features that don't exist yet
- Discount before you've established willingness-to-pay (jumping straight to "founding member pricing" cheapens the offer)
