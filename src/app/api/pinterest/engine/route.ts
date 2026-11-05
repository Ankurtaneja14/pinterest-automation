import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  getOrCreateEngineSettings,
  updateEngineSettings,
  processDueJobs,
  recoverStaleLeasedJobs,
} from "@/server/pinterest/publishing-worker";
import { getJobStats } from "@/server/pinterest/job-service";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const [settings, stats, accountStats] = await Promise.all([
    getOrCreateEngineSettings(),
    getJobStats(),
    prisma.pinterestAccount.groupBy({
      by: ["status"],
      _count: { id: true },
    }),
  ]);
  return NextResponse.json({ settings, stats, accountStats });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  const body = (await request.json()) as {
    action?: string;
    workerConcurrency?: number;
    retryLimit?: number;
    timezone?: string;
  };

  switch (body.action) {
    case "start": {
      await updateEngineSettings({ engineEnabled: true, engineStatus: "Running" });
      // Kick off an immediate processing round (non-blocking)
      void processDueJobs().catch(console.error);
      return NextResponse.json({ ok: true, status: "Running" });
    }

    case "pause": {
      await updateEngineSettings({ engineEnabled: false, engineStatus: "Paused" });
      return NextResponse.json({ ok: true, status: "Paused" });
    }

    case "resume": {
      await updateEngineSettings({ engineEnabled: true, engineStatus: "Running" });
      void processDueJobs().catch(console.error);
      return NextResponse.json({ ok: true, status: "Running" });
    }

    case "stop": {
      await updateEngineSettings({ engineEnabled: false, engineStatus: "Stopped" });
      return NextResponse.json({ ok: true, status: "Stopped" });
    }

    case "poll": {
      // Called by frontend polling loop while engine is running
      const result = await processDueJobs();
      return NextResponse.json({ ok: true, ...result });
    }

    case "recover": {
      const count = await recoverStaleLeasedJobs();
      return NextResponse.json({ ok: true, recovered: count });
    }

    case "updateSettings": {
      const updated = await updateEngineSettings({
        workerConcurrency: body.workerConcurrency,
        retryLimit: body.retryLimit,
        timezone: body.timezone,
      });
      return NextResponse.json({ ok: true, settings: updated });
    }

    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}

