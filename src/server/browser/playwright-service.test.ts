import { describe, expect, it } from "vitest";
import { getPlaywrightBrowserStatus } from "./playwright-service";

describe("playwright-service", () => {
  it("reports browser readiness and locates chromium executable", async () => {
    const status = await getPlaywrightBrowserStatus();
    expect(status.ready).toBe(true);
    expect(status.executablePath).toBeTruthy();
    expect(status.userDataDir).toContain("storage");
  });
});

