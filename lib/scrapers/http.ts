/**
 * Shared HTTP utility for all scrapers. Handles the anti-bot friction we hit
 * on michigan.gov, sbafla.com, calstrs.com, nystrs.org etc. — plain `fetch`
 * with no headers gets 403'd. All scraper modules in this directory must use
 * `fetchWithDefaults` instead of calling `fetch` directly.
 *
 * Defaults applied:
 *   - Realistic desktop Chrome User-Agent
 *   - Accept-Language, Accept, Connection keep-alive
 *   - 30s timeout via AbortController
 *   - Manual redirect following, capped at 5 hops
 *   - Typed error on 403 / 429 so callers can distinguish bot-blocks from
 *     genuine 404s
 */

// Realistic desktop Chrome UA string (stable channel, Apr 2026). Update
// periodically — sites that fingerprint aggressively will reject obviously
// stale versions.
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36";

const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent": DEFAULT_USER_AGENT,
  "accept-language": "en-US,en;q=0.9",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  connection: "keep-alive",
  "upgrade-insecure-requests": "1",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

export class BotBlockedError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly statusText: string,
  ) {
    super(
      `Bot-blocked or rate-limited: HTTP ${status} ${statusText} at ${url}. ` +
        `The site may require a real browser, cookies, or a different UA.`,
    );
    this.name = "BotBlockedError";
  }
}

export type FetchWithDefaultsOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  method?: string;
  body?: BodyInit | null;
  cache?: RequestCache;
  /**
   * If true, do NOT throw on 403/429 — return the Response so the caller can
   * decide. Still respects the redirect cap and timeout. Default: false.
   */
  allowBotBlocked?: boolean;
};

/**
 * Fetch a URL with browser-like defaults, timeout, and manual redirect cap.
 *
 * Throws:
 *   - BotBlockedError on 403 or 429 (unless allowBotBlocked is set)
 *   - Error on timeout, too many redirects, or network failure
 *   - The raw Response is returned for all other statuses (including 404, 5xx)
 *     — callers handle those contextually (e.g. NYSCRF 404 = month not yet
 *     published, not an error).
 */
export async function fetchWithDefaults(
  url: string,
  options: FetchWithDefaultsOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const mergedHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...(options.headers ?? {}),
  };

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(current, {
        method: options.method ?? "GET",
        headers: mergedHeaders,
        body: options.body,
        cache: options.cache ?? "no-store",
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const e = err as { name?: string };
      if (e?.name === "AbortError") {
        throw new Error(`fetch timeout after ${timeoutMs}ms: ${current}`);
      }
      throw err;
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, current).toString();
      continue;
    }

    if ((res.status === 403 || res.status === 429) && !options.allowBotBlocked) {
      throw new BotBlockedError(current, res.status, res.statusText);
    }

    return res;
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS}) starting from ${url}`);
}

/**
 * Convenience wrapper for scrapers that just need the HTML text.
 */
export async function fetchText(
  url: string,
  options: FetchWithDefaultsOptions = {},
): Promise<string> {
  const res = await fetchWithDefaults(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${url}`);
  }
  return await res.text();
}
