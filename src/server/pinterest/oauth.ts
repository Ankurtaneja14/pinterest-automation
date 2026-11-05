/**
 * Pinterest OAuth 2.0 (PKCE) helper.
 *
 * Uses the official Pinterest v5 API.
 * Scopes required:  user_accounts:read  boards:read  pins:write
 *
 * The PKCE code-verifier is stored in PinterestOAuthState so no session
 * middleware is needed.
 */
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const PINTEREST_API_BASE = "https://api.pinterest.com/v5";
const PINTEREST_AUTH_URL = "https://www.pinterest.com/oauth/";

export function pinterestAppId(): string {
  const v = process.env.PINTEREST_APP_ID;
  if (!v) throw new Error("PINTEREST_APP_ID is not configured.");
  return v;
}

export function pinterestAppSecret(): string {
  const v = process.env.PINTEREST_APP_SECRET;
  if (!v) throw new Error("PINTEREST_APP_SECRET is not configured.");
  return v;
}

export function pinterestRedirectUri(): string {
  const v = process.env.PINTEREST_REDIRECT_URI;
  if (!v) throw new Error("PINTEREST_REDIRECT_URI is not configured.");
  return v;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generateCodeVerifier(): string {
  return base64url(randomBytes(48));
}

function generateCodeChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier).digest());
}

export async function createOAuthUrl(): Promise<{ url: string; state: string }> {
  // Purge expired states
  await prisma.pinterestOAuthState.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  const state = base64url(randomBytes(32));
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  await prisma.pinterestOAuthState.create({
    data: {
      state,
      codeVerifier,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  const params = new URLSearchParams({
    client_id: pinterestAppId(),
    redirect_uri: pinterestRedirectUri(),
    response_type: "code",
    scope: "user_accounts:read,boards:read,pins:write",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return { url: `${PINTEREST_AUTH_URL}?${params.toString()}`, state };
}

export interface PinterestTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export async function exchangeCodeForTokens(
  code: string,
  state: string,
): Promise<PinterestTokens> {
  // Validate state and retrieve code verifier
  const oauthState = await prisma.pinterestOAuthState.findUnique({
    where: { state },
  });
  if (!oauthState || oauthState.expiresAt < new Date()) {
    if (oauthState) {
      await prisma.pinterestOAuthState.delete({ where: { state } }).catch(() => {});
    }
    throw new Error("OAuth state is invalid or has expired. Please try connecting again.");
  }
  const codeVerifier = oauthState.codeVerifier;
  await prisma.pinterestOAuthState.delete({ where: { state } });

  const credentials = Buffer.from(
    `${pinterestAppId()}:${pinterestAppSecret()}`,
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pinterestRedirectUri(),
    code_verifier: codeVerifier,
  });

  const response = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Pinterest token exchange failed (${response.status}): ${text}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined,
  };
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<PinterestTokens> {
  const credentials = Buffer.from(
    `${pinterestAppId()}:${pinterestAppSecret()}`,
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(`${PINTEREST_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(no body)");
    throw new Error(
      `Pinterest token refresh failed (${response.status}): ${text}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : undefined,
  };
}

