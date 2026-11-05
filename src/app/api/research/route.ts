import { after, NextResponse } from "next/server";
import { z } from "zod";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  enqueueResearch,
  getResearchHistory,
  processResearchSession,
  ResearchSessionError,
} from "@/server/research/research-persistence";

export const runtime = "nodejs";
export const maxDuration = 300;

const startResearchSchema = z.object({
  scheduleId: z.string().trim().min(1).max(100),
});

export async function GET(request: Request) {
  const scheduleId = new URL(request.url).searchParams.get("scheduleId");
  if (!scheduleId) {
    return NextResponse.json(
      { error: "Select a schedule to view its research." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getResearchHistory(scheduleId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof ResearchSessionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 400 },
      );
    }
    console.error("Could not read research history", error);
    return NextResponse.json(
      { error: "Research history is temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = startResearchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid schedule ID is required." },
      { status: 422 },
    );
  }

  try {
    const queued = await enqueueResearch(parsed.data.scheduleId);
    if (queued.alreadyRunning) {
      return NextResponse.json(
        { sessionId: queued.sessionId, status: "Running" },
        { status: 202 },
      );
    }
    after(async () => {
      try {
        await processResearchSession(queued.sessionId);
      } catch (error) {
        console.error("Background research session failed", {
          sessionId: queued.sessionId,
          message:
            error instanceof Error ? error.message : "Unexpected research failure.",
        });
      }
    });
    return NextResponse.json(
      { sessionId: queued.sessionId, status: "Pending" },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof ResearchSessionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 400 },
      );
    }
    console.error("Could not queue research session", error);
    return NextResponse.json(
      { error: "The research session could not be started." },
      { status: 503 },
    );
  }
}
