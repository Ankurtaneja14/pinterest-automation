import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  createPublishingJobs,
  listJobs,
  approveJobs,
  cancelJobs,
  getJobStats,
} from "@/server/pinterest/job-service";
import { z } from "zod";

export const runtime = "nodejs";

const createSchema = z.object({
  contentPackageIds: z.array(z.string().min(1)).min(1),
  accountBoardPairs: z
    .array(z.object({ accountId: z.string(), boardId: z.string() }))
    .min(1),
  scheduledAt: z.string().datetime(),
});

const bulkActionSchema = z.object({
  action: z.enum(["approve", "cancel"]),
  jobIds: z.array(z.string()).min(1),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId") ?? undefined;
  const contentPackageId = url.searchParams.get("contentPackageId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const approvalStatus = url.searchParams.get("approvalStatus") ?? undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "50");

  const [result, stats] = await Promise.all([
    listJobs({ accountId, contentPackageId, status: status as any, approvalStatus, page, pageSize }),
    getJobStats(),
  ]);

  return NextResponse.json({ ...result, stats });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  const body: unknown = await request.json();

  // Check for bulk action
  const bulkParsed = bulkActionSchema.safeParse(body);
  if (bulkParsed.success) {
    const { action, jobIds } = bulkParsed.data;
    if (action === "approve") {
      const count = await approveJobs(jobIds);
      return NextResponse.json({ ok: true, count });
    }
    if (action === "cancel") {
      const count = await cancelJobs(jobIds);
      return NextResponse.json({ ok: true, count });
    }
  }

  // Job creation
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const count = await createPublishingJobs({
    contentPackageIds: parsed.data.contentPackageIds,
    accountBoardPairs: parsed.data.accountBoardPairs,
    scheduledAt: new Date(parsed.data.scheduledAt),
  });

  return NextResponse.json({ ok: true, jobsCreated: count }, { status: 201 });
}

