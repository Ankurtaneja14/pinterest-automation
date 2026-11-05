import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  startPinterestLoginSession,
  getPinterestLoginSessionStatus,
  cancelPinterestLoginSession,
} from "@/server/pinterest/browser-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  try {
    const { sessionId } = await startPinterestLoginSession();
    return NextResponse.json({ ok: true, sessionId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start Pinterest login session." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  // GET is read-only (status polling). No origin check needed — no CSRF risk.
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
  }

  const sessionState = getPinterestLoginSessionStatus(sessionId);
  return NextResponse.json(sessionState);
}

export async function DELETE(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (sessionId) {
    await cancelPinterestLoginSession(sessionId);
  }

  return NextResponse.json({ ok: true });
}

