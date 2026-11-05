import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import { cancelJobs, rescheduleJob } from "@/server/pinterest/job-service";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const JOB_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

type Params = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { jobId } = await params;
  if (!JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }
  const job = await prisma.pinterestPublishingJob.findUnique({
    where: { id: jobId },
    include: {
      account: { select: { id: true, username: true, displayName: true, profileImage: true } },
      board: { select: { id: true, name: true } },
      contentPackage: {
        select: {
          id: true,
          pinterestTitle: true,
          description: true,
          destinationUrl: true,
          assets: { where: { status: "Complete" }, take: 1, select: { id: true } },
        },
      },
    },
  });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  return NextResponse.json({ job });
}

export async function PATCH(request: Request, { params }: Params) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  const { jobId } = await params;
  if (!JOB_ID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
  }
  const body = (await request.json()) as { action?: string; scheduledAt?: string };
  if (body.action === "cancel") {
    await cancelJobs([jobId]);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "reschedule" && body.scheduledAt) {
    await rescheduleJob(jobId, new Date(body.scheduledAt));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}

