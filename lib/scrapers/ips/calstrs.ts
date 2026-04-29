/**
 * CalSTRS IPS uses the index-crawl pattern (vs CalPERS/NYSCRF/Oregon's
 * stable-URL pattern). The IPS PDF URL contains a hash + version date
 * that rotates each policy revision, so we discover the current URL
 * from the index page (https://www.calstrs.com/investment-policies)
 * rather than hitting a fixed URL.
 *
 * The index page lists ~20 PDFs: master IPS + 19 per-asset-class
 * sub-policies (Private Equity, Real Estate, Fixed Income, Global
 * Equity, Infrastructure, Risk Mitigating Strategies, etc.). We
 * extract the master only; sub-policies are deferred to Week 2+ work.
 *
 * Master IPS identification:
 *   1. Anchor text exactly "Investment Policy Statement" (primary).
 *   2. Filename matches /^InvestmentPolicyStatement[\d-]+\.pdf$/i
 *      (fallback if the anchor text is rephrased).
 *   3. Sub-policy filenames carry asset-class prefixes
 *      (GlobalEquity-, FixedIncome-, PrivateEquity-, etc.) and are
 *      naturally excluded by both checks.
 *
 * Same deviation from CAFR pattern as the stable-URL IPS scrapers:
 * scraper-side text extraction via unpdf, text-hash for dedup.
 */

import * as cheerio from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchText } from "../http";
import { ingestIps, resolvePlanId, type IpsIngestResult } from "./index";

export const CALSTRS_IPS_INDEX =
  "https://www.calstrs.com/investment-policies";

const MASTER_IPS_FILENAME_RE = /^InvestmentPolicyStatement[\d-]+\.pdf$/i;

export async function discoverCalSTRSIPSURL(): Promise<string> {
  const html = await fetchText(CALSTRS_IPS_INDEX);
  const $ = cheerio.load(html);

  // Primary: exact anchor text match.
  let found: string | null = null;
  $("a[href]").each((_, el) => {
    if (found) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href") || "";
    if (
      text === "Investment Policy Statement" &&
      href.toLowerCase().endsWith(".pdf")
    ) {
      found = new URL(href, CALSTRS_IPS_INDEX).toString();
    }
  });
  if (found) return found;

  // Fallback: filename regex.
  $("a[href]").each((_, el) => {
    if (found) return;
    const href = $(el).attr("href") || "";
    const filename = href.split("/").pop() ?? "";
    if (MASTER_IPS_FILENAME_RE.test(filename)) {
      found = new URL(href, CALSTRS_IPS_INDEX).toString();
    }
  });

  if (!found) {
    throw new Error(
      "CalSTRS IPS scraper: could not identify the master IPS link on " +
        `${CALSTRS_IPS_INDEX}. Both anchor-text and filename heuristics ` +
        "failed; the index structure may have changed.",
    );
  }
  return found;
}

export async function scrapeCalSTRSIPS(
  supabase: SupabaseClient,
  opts: { planId?: string } = {},
): Promise<IpsIngestResult> {
  const planId = opts.planId ?? (await resolvePlanId(supabase, "CalSTRS"));
  const url = await discoverCalSTRSIPSURL();
  return ingestIps(supabase, {
    planId,
    planKey: "calstrs",
    planName: "CalSTRS",
    url,
  });
}
