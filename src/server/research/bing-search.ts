import type { ResearchSearchResult } from "./schemas";

const BING_RSS_ENDPOINT = "https://www.bing.com/search";
const SEARCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export class ResearchRetrievalError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ResearchRetrievalError";
  }
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      if (code[0] === "#") {
        const hex = code[1]?.toLowerCase() === "x";
        const parsed = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
          return Number.isFinite(parsed) && parsed >= 0 && parsed <= 0x10ffff
            ? String.fromCodePoint(parsed)
            : " ";
      }
      const entities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      return entities[code.toLowerCase()] ?? " ";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function xmlField(item: string, name: string): string {
  const match = item.match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"),
  );
  return match ? decodeXml(match[1]) : "";
}

export function canonicalizeSourceUrl(sourceUrl: string): string | null {
  try {
    const url = new URL(sourceUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hostname === "bing.com" ||
      url.hostname.endsWith(".bing.com")
    ) {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        /^utm_/i.test(key) ||
        ["gclid", "fbclid", "msclkid", "ref", "source"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function parseBingRss(
  xml: string,
  query: string,
  limit = 5,
): ResearchSearchResult[] {
  const items = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  const results: ResearchSearchResult[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const title = xmlField(item, "title");
    const sourceUrl = xmlField(item, "link");
    const excerpt = xmlField(item, "description");
    const canonicalUrl = canonicalizeSourceUrl(sourceUrl);
    if (
      !canonicalUrl ||
      title.length < 3 ||
      excerpt.length < 30 ||
      seen.has(canonicalUrl)
    ) {
      continue;
    }
    seen.add(canonicalUrl);
    const published = xmlField(item, "pubDate");
    const publishedDate = published ? new Date(published) : null;
    results.push({
      title: title.slice(0, 300),
      url: sourceUrl,
      canonicalUrl,
      publishedAt:
        publishedDate && Number.isFinite(publishedDate.valueOf())
          ? publishedDate.toISOString()
          : null,
      excerpt: excerpt.slice(0, 1600),
      query,
    });
    if (results.length >= limit) {
      break;
    }
  }

  return results;
}

export async function searchBingRss(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<ResearchSearchResult[]> {
  const url = new URL(BING_RSS_ENDPOINT);
  url.searchParams.set("format", "rss");
  url.searchParams.set("q", query);

  let response: Response;
  try {
    response = await fetcher(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      headers: {
        accept: "application/rss+xml, application/xml, text/xml",
        "user-agent": "PinterestResearchEngine/1.0",
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new ResearchRetrievalError(
        "Public search timed out. Try again later.",
      );
    }
    throw new ResearchRetrievalError(
      "Could not reach the public search provider.",
    );
  }

  if (!response.ok) {
    throw new ResearchRetrievalError(
      `Public search returned HTTP ${response.status}.`,
      response.status,
    );
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > MAX_RESPONSE_BYTES) {
    throw new ResearchRetrievalError("Public search response exceeded the size limit.");
  }
  const xml = await response.text();
  if (Buffer.byteLength(xml, "utf8") > MAX_RESPONSE_BYTES) {
    throw new ResearchRetrievalError("Public search response exceeded the size limit.");
  }
  if (!/<rss(?:\s|>)/i.test(xml)) {
    throw new ResearchRetrievalError(
      "Public search returned an unexpected response instead of RSS results.",
    );
  }

  return parseBingRss(xml, query);
}
