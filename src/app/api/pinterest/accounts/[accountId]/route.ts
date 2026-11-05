import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  getAccount,
  disconnectAccount,
  deleteAccount,
  setDefaultBoard,
  AccountNotFoundError,
} from "@/server/pinterest/account-service";

export const runtime = "nodejs";

const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

type Params = { params: Promise<{ accountId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { accountId } = await params;
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
  }
  try {
    const account = await getAccount(accountId);
    return NextResponse.json({ account });
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not load account." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  const { accountId } = await params;
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
  }

  const body = (await request.json()) as { action?: string; boardId?: string };

  if (body.action === "disconnect") {
    try {
      await disconnectAccount(accountId);
      return NextResponse.json({ ok: true, message: "Account disconnected." });
    } catch (err) {
      if (err instanceof AccountNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      return NextResponse.json({ error: "Could not disconnect account." }, { status: 500 });
    }
  }

  if (body.action === "setDefaultBoard" && body.boardId) {
    try {
      await setDefaultBoard(accountId, body.boardId);
      return NextResponse.json({ ok: true });
    } catch {
      return NextResponse.json({ error: "Could not update default board." }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

export async function DELETE(request: Request, { params }: Params) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  const { accountId } = await params;
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
  }
  try {
    await deleteAccount(accountId);
    return NextResponse.json({ ok: true, message: "Account removed." });
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Could not remove account." }, { status: 500 });
  }
}

