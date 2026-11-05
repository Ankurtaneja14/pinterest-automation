import { describe, expect, it, vi } from "vitest";
import {
  canonicalizeSourceUrl,
  parseBingRss,
  searchBingRss,
} from "./bing-search";

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Small-space guide &amp; ideas</title>
    <link>https://example.com/guide?utm_source=bing&amp;page=1#top</link>
    <description>Practical storage ideas for renters who need flexible organization in a small home.</description>
    <pubDate>Tue, 03 Nov 2026 03:25:00 GMT</pubDate>
  </item>
  <item>
    <title>Duplicate without tracking</title>
    <link>https://example.com/guide?page=1</link>
    <description>A duplicate excerpt with enough words to pass minimum content validation.</description>
  </item>
  <item>
    <title>Invalid Bing result</title>
    <link>https://www.bing.com/search?q=internal</link>
    <description>This search page is not a public source.</description>
  </item>
  <item>
    <title>Useful public source</title>
    <link>https://another.example/research</link>
    <description><![CDATA[<b>Evidence</b> for household organization and renter-friendly storage solutions.]]></description>
  </item>
</channel></rss>`;

describe("Bing RSS retrieval", () => {
  it("extracts usable public source metadata and canonicalizes tracking URLs", () => {
    const results = parseBingRss(rss, "small-space organization");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "Small-space guide & ideas",
      canonicalUrl: "https://example.com/guide?page=1",
      excerpt:
        "Practical storage ideas for renters who need flexible organization in a small home.",
      query: "small-space organization",
    });
    expect(results[0].publishedAt).toBe("2026-11-03T03:25:00.000Z");
    expect(results[1].excerpt).toContain("Evidence for household organization");
    expect(canonicalizeSourceUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeSourceUrl("https://user:pass@example.com/")).toBeNull();
  });

  it("uses only the fixed RSS endpoint and reports failed provider responses", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).origin).toBe("https://www.bing.com");
      return new Response(rss, { status: 200 });
    });
    const results = await searchBingRss("niche topic", fetcher);

    expect(results.length).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledOnce();

    await expect(
      searchBingRss(
        "niche topic",
        vi.fn(async () => new Response("blocked", { status: 403 })),
      ),
    ).rejects.toMatchObject({
      name: "ResearchRetrievalError",
      status: 403,
    });
  });
});
