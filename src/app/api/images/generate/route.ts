import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  ImageGenerationError,
  getImagePromptForIdea,
  prepareGeneratedImage,
  saveGeneratedImage,
  markGeneratedImageFailed,
} from "@/server/images/image-persistence";
import { generateImageWithGemini } from "@/server/browser/playwright-service";

export const runtime = "nodejs";
export const maxDuration = 310;

const requestSchema = z.object({
  researchSessionId: z.string().trim().min(1).max(100),
  ideaId: z.string().trim().min(1).max(100),
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
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "A research session and selected idea are required." },
      { status: 422 },
    );
  }

  // 1. Get the prompt (read-only, no asset claimed yet)
  let imagePrompt: string;
  try {
    const result = await getImagePromptForIdea(
      parsed.data.researchSessionId,
      parsed.data.ideaId,
    );
    imagePrompt = result.imagePrompt;
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 400 });
    }
    return NextResponse.json({ error: "Could not retrieve the image prompt." }, { status: 500 });
  }

  // 2. Claim the asset row (sets status → "Generating")
  let claim: Awaited<ReturnType<typeof prepareGeneratedImage>> | undefined;
  try {
    claim = await prepareGeneratedImage(
      parsed.data.researchSessionId,
      parsed.data.ideaId,
    );
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 400 });
    }
    return NextResponse.json({ error: "Could not prepare image generation." }, { status: 500 });
  }

  // 3. Run Playwright automation: open Chrome → Gemini → type prompt → send →
  //    wait for image → download bytes.
  let imageBuffer: Buffer;
  try {
    imageBuffer = await generateImageWithGemini(imagePrompt);
  } catch (error) {
    // Mark the asset as failed so the UI shows an error and the user can retry.
    const message =
      error instanceof Error
        ? error.message
        : "Gemini did not produce an image.";
    try {
      await markGeneratedImageFailed(claim, message, "gemini-assisted");
    } catch (markError) {
      console.error("Could not record Gemini generation failure", markError);
    }
    console.error("Gemini image generation failed", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // 4. Validate, normalise to WebP, and persist the image.
  try {
    const saved = await saveGeneratedImage(
      parsed.data.researchSessionId,
      parsed.data.ideaId,
      imageBuffer,
      undefined,
      "gemini-assisted",
      claim,
    );
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json({ error: error.message }, { status: error.status ?? 500 });
    }
    console.error("Could not save Gemini pin image", error);
    return NextResponse.json(
      { error: "The image was generated but could not be saved." },
      { status: 500 },
    );
  }
}
