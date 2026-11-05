import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import { syncAccountProfile, AccountNotFoundError } from "@/server/pinterest/account-service";

export const runtime = "nodejs";

const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

type Params = { params: Promise<{ accountId: string }> };

export async function POST(request: Request, { params }: Params) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  const { accountId } = await params;
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
  }
  try {
    await syncAccountProfile(accountId);
    return NextResponse.json({ ok: true, message: "Account synchronised." });
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed." },
      { status: 500 },
    );
  }
}

