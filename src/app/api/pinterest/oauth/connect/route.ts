import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import { createOAuthUrl } from "@/server/pinterest/oauth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  try {
    const { url, state } = await createOAuthUrl();
    return NextResponse.json({ url, state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not start Pinterest OAuth." },
      { status: 500 },
    );
  }
}

