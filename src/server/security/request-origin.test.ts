import { describe, expect, it } from "vitest";
import { hasSameOrigin } from "./request-origin";

describe("hasSameOrigin", () => {
  it("accepts same-origin browser requests", () => {
    const request = new Request("http://127.0.0.1:3000/api/schedules/import", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3000" },
    });

    expect(hasSameOrigin(request)).toBe(true);
  });

  it("rejects cross-origin and origin-less requests", () => {
    const crossOrigin = new Request("http://127.0.0.1:3000/api/schedules/import", {
      method: "POST",
      headers: { origin: "https://untrusted.example" },
    });
    const originless = new Request("http://127.0.0.1:3000/api/schedules/import", {
      method: "POST",
    });

    expect(hasSameOrigin(crossOrigin)).toBe(false);
    expect(hasSameOrigin(originless)).toBe(false);
  });
});
