import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOAuthUrl, pinterestAppId, pinterestAppSecret, pinterestRedirectUri } from "./oauth";
import { prisma } from "@/lib/prisma";

describe("Pinterest OAuth Service", () => {
  beforeEach(() => {
    process.env.PINTEREST_APP_ID = "test-app-id";
    process.env.PINTEREST_APP_SECRET = "test-app-secret";
    process.env.PINTEREST_REDIRECT_URI = "http://127.0.0.1:4000/api/pinterest/oauth/callback";
  });

  it("reads Pinterest configuration from environment", () => {
    expect(pinterestAppId()).toBe("test-app-id");
    expect(pinterestAppSecret()).toBe("test-app-secret");
    expect(pinterestRedirectUri()).toBe("http://127.0.0.1:4000/api/pinterest/oauth/callback");
  });

  it("throws descriptive error when environment variables are missing", () => {
    delete process.env.PINTEREST_APP_ID;
    expect(() => pinterestAppId()).toThrow("PINTEREST_APP_ID is not configured.");
  });

  it("generates a valid OAuth URL with PKCE and state stored in database", async () => {
    process.env.PINTEREST_APP_ID = "test-app-id";
    const { url, state } = await createOAuthUrl();

    expect(url).toContain("https://www.pinterest.com/oauth/");
    expect(url).toContain("client_id=test-app-id");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("user_accounts%3Aread%2Cboards%3Aread%2Cpins%3Awrite");
    expect(state).toBeDefined();

    // Verify stored in DB
    const saved = await prisma.pinterestOAuthState.findUnique({
      where: { state },
    });
    expect(saved).not.toBeNull();
    expect(saved?.codeVerifier).toBeDefined();

    // Clean up
    await prisma.pinterestOAuthState.delete({ where: { state } });
  });
});

