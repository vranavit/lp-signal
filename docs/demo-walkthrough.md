# Allocus 5-minute demo walkthrough

Pre-flight: signed in as `vitek.vrana@bloorcapital.com`, 2 tabs open — one on
`/pensions/calstrs`, one ready to navigate from. Laptop on wired connection.
Ad-block off so the Supabase signed-URL modal loads cleanly.

---

## 0:00–0:30 — Opening

> "Allocus is LP intelligence for private markets fundraising. Most IR teams
> today rely on Preqin (quarterly, stale) and LinkedIn (noisy, anecdotal) to
> figure out which pensions have budget for their fund. Allocus watches US
> public pension disclosures in real time and tells you specifically which
> LPs have unfunded deployment budget. Let me show you what that means with
> one pension."

**Transition:** tab to `/pensions/calstrs`.

---

## 0:30–2:00 — CalSTRS pension profile

Point to the **$8.21B hero number** top-right.

> "This is CalSTRS — third largest US public pension, $373B AUM. That $8.21B
> is their current unfunded private markets budget. It's not a marketing
> number — it's literally (target allocation − actual allocation) times AUM,
> summed across PE / Infra / Credit / RE / VC, and capped at zero for any
> class where they're overweight. Every one of those numbers comes from
> their most recent CAFR — specifically the policy table on page 47 of the
> FY 2024–25 Annual Comprehensive Financial Report, published last October."

Scroll to the per-class chips.

> "The headline breaks down by asset class. CalSTRS has roughly $8B of
> underweight on Real Estate alone — they're sitting at 12.8% vs their 15%
> target. On a $373B fund, that 2.2 percentage-point gap is your cold email
> pitch if you run a mid-market RE fund."

Scroll to the allocation gap table.

> "Each row is one asset class row from the CAFR policy table. Target,
> policy range, actual, gap in percentage points, gap in dollars. Green is
> underweight (deployable budget); red is overweight (rebalancing pressure,
> not your opportunity). Notice RE is +2.2pp green at +$8B — that's the
> single biggest underweight CalSTRS has right now."

If available, also mention: **Absolute Return +2.7pp green (~$10B)**,
**Fixed Income +1.0pp green (~$3.7B)** — quick scan to show the page is
dense with deployable-budget signals, not just one number.

---

## 2:00–3:00 — Audit trail

Click the **source icon on the Private Equity row**.

> "This is the part that makes the number defensible. Every single row
> in Allocus is tied back to a verbatim quote from the source document.
> One click — here's the PDF we pulled, the page it came from, and the
> exact language. We can open the signed PDF if we want."

If the signed URL loads, click through briefly to show the CAFR page 47
with the policy table highlighted. Close the modal.

> "When you put an Allocus number in front of a Managing Partner or LP,
> they can trace it back to a government disclosure in one click. No black
> boxes. This is the single biggest difference vs every other LP-data tool
> I've talked to."

---

## 3:00–4:00 — Outreach dashboard

Navigate to `/outreach`.

> "This is the cross-pension view. Top table ranks every pension we track
> by unfunded private markets budget. You can filter to a threshold — show
> me just plans with over $500M of deployable RE, over $1B, whatever your
> fund's minimum viable check size is."

Set the dropdown to **≥ $500M**.

> "This is your cold email target list, sorted by deployable dollars.
> Today that's CalSTRS at $8.2B and — as we ingest more CAFRs — Illinois
> TRS, WSIB, NYSCRF. By end of Q3 I expect this list to be 15–20 plans
> tall. For a mid-market PE fund raising $2B, you probably only need two
> or three of these to commit."

Scroll down to signals table.

> "Below the pension-level view are individual transaction signals —
> specific commitments each pension has made recently. Filter by asset
> class, by commitment size, by direction (new vs re-up). Every row links
> back to the source with the same one-click audit."

CSV export button:

> "Export any filtered view to CSV to drop into your CRM or pipeline
> tracker."

---

## 4:00–5:00 — Close

> "To recap: Allocus watches 8 pensions today with ~$20B of tracked
> unfunded budget across CalSTRS, Illinois TRS, NYSCRF, and the others
> you saw. Plus 2 GPs on the press-release side, so when a Blackstone or
> Brookfield announces a fund close that names an LP, you see it the day
> it happens."
>
> "Adding 1–2 pensions per week. Roadmap is 50+ pensions plus a warm-intro
> relationship layer — who at each pension has the signing authority and
> how you get to them — by end of Q3."
>
> "Pricing is TBD based on firm size and seats, but we're in closed beta
> right now with a handful of design partners. Happy to extend a seat if
> your IR team wants to pilot. What questions do you have?"

---

## Recovery lines if something breaks

- **CalSTRS page loads empty.** "Live data — occasionally a CAFR ingestion
  is mid-refresh. Here's the cached screenshot" (open `/outreach` instead).
- **Audit modal fails to load signed URL.** "Signed URLs are 10-minute TTL
  by design — here's the public source URL we can fall back to." (The
  modal already renders the source_url fallback.)
- **Outreach shows zero plans.** "Default filter is ≥$0 — let me adjust."
- **Demo cut short to 3 minutes.** Drop Outreach (section 3:00–4:00),
  keep pension profile + audit trail, close direct.
