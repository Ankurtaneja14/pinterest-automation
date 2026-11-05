import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import { syncBoards, getAccount, AccountNotFoundError } from "@/server/pinterest/account-service";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const ACCOUNT_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

type Params = { params: Promise<{ accountId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { accountId } = await params;
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
  }
  try {
    const boards = await prisma.pinterestBoard.findMany({
      where: { accountId, status: "Active" },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ boards });
  } catch {
    return NextResponse.json({ error: "Could not load boards." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Params) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  const { accountId } = await params;
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return NextResponse.json({ error: "Invalid account ID." }, { status: 400 });
  }
  try {
    await syncBoards(accountId);
    const boards = await prisma.pinterestBoard.findMany({
      where: { accountId, status: "Active" },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ boards });
  } catch (err) {
    if (err instanceof AccountNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Board sync failed." },
      { status: 500 },
    );
  }
}

