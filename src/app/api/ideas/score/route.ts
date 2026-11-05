import { after, NextResponse } from "next/server";
import { z } from "zod";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  enqueueIdeaScoring,
  IdeaScoringError,
  processIdeaScoring,
} from "@/server/ideas/scoring-persistence";

export const runtime = "nodejs";
export const maxDuration = 300;

const scoreRequestSchema = z.object({
  researchSessionId: z.string().trim().min(1).max(100),
});

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
  const parsed = scoreRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid research session ID is required." },
      { status: 422 },
    );
  }

  try {
    const queued = await enqueueIdeaScoring(parsed.data.researchSessionId);
    if (queued.alreadyComplete) {
      return NextResponse.json({ status: "Scored" });
    }
    if (queued.alreadyRunning) {
      return NextResponse.json({ status: "Scoring" }, { status: 202 });
    }
    after(async () => {
      try {
        await processIdeaScoring(parsed.data.researchSessionId);
      } catch (error) {
        console.error("Background idea scoring failed", {
          researchSessionId: parsed.data.researchSessionId,
          message: error instanceof Error ? error.message : "Unexpected scoring failure.",
        });
      }
    });
    return NextResponse.json({ status: "Scoring" }, { status: 202 });
  } catch (error) {
    if (error instanceof IdeaScoringError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 400 },
      );
    }
    console.error("Could not queue idea scoring", error);
    return NextResponse.json(
      { error: "Idea scoring could not be started." },
      { status: 503 },
    );
  }
}
