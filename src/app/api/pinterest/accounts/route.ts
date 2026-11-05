import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import { listAccounts } from "@/server/pinterest/account-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const accounts = await listAccounts();
    return NextResponse.json({ accounts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not load accounts." },
      { status: 500 },
    );
  }
}

