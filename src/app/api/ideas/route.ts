import { after, NextResponse } from "next/server";
import { z } from "zod";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  enqueueIdeaGeneration,
  getIdeaWorkspace,
  IdeaGenerationError,
  processIdeaGeneration,
} from "@/server/ideas/idea-persistence";

export const runtime = "nodejs";
export const maxDuration = 300;

const ideaRequestSchema = z.object({
  scheduleId: z.string().trim().min(1).max(100),
});

export async function GET(request: Request) {
  const scheduleId = new URL(request.url).searchParams.get("scheduleId");
  if (!scheduleId) {
    return NextResponse.json(
      { error: "Select a schedule to view its ideas." },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json(await getIdeaWorkspace(scheduleId), {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof IdeaGenerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 400 },
      );
    }
    console.error("Could not read idea workspace", error);
    return NextResponse.json(
      { error: "The idea workspace is temporarily unavailable." },
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
  const parsed = ideaRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A valid schedule ID is required." },
      { status: 422 },
    );
  }

  try {
    const queued = await enqueueIdeaGeneration(parsed.data.scheduleId);
    if (queued.alreadyComplete) {
      return NextResponse.json(
        {
          researchSessionId: queued.researchSessionId,
          status: "IdeasGenerated",
        },
        { status: 200 },
      );
    }
    if (queued.alreadyRunning) {
      return NextResponse.json(
        {
          researchSessionId: queued.researchSessionId,
          status: "IdeasGenerating",
        },
        { status: 202 },
      );
    }
    after(async () => {
      try {
        await processIdeaGeneration(queued.researchSessionId);
      } catch (error) {
        console.error("Background idea generation failed", {
          researchSessionId: queued.researchSessionId,
          message: error instanceof Error ? error.message : "Unexpected generation failure.",
        });
      }
    });
    return NextResponse.json(
      {
        researchSessionId: queued.researchSessionId,
        status: "IdeasGenerating",
      },
      { status: 202 },
    );
  } catch (error) {
    if (error instanceof IdeaGenerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 400 },
      );
    }
    console.error("Could not queue idea generation", error);
    return NextResponse.json(
      { error: "Idea generation could not be started." },
      { status: 503 },
    );
  }
}
