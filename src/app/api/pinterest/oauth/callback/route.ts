import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/server/pinterest/oauth";
import { connectAccount, AccountLimitError } from "@/server/pinterest/account-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/pinterest/accounts?error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/pinterest/accounts?error=missing_params", request.url),
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code, state);
    const accountId = await connectAccount(tokens);
    return NextResponse.redirect(
      new URL(`/pinterest/accounts?connected=${accountId}`, request.url),
    );
  } catch (err) {
    const isLimit = err instanceof AccountLimitError;
    const message = err instanceof Error ? err.message : "Connection failed.";
    return NextResponse.redirect(
      new URL(
        `/pinterest/accounts?error=${encodeURIComponent(isLimit ? "limit_reached" : message)}`,
        request.url,
      ),
    );
  }
}

