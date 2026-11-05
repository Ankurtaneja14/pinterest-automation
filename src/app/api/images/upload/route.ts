import { NextResponse } from "next/server";
import {
  ImageGenerationError,
  saveGeneratedImage,
} from "@/server/images/image-persistence";
import { hasSameOrigin } from "@/server/security/request-origin";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "Request origin rejected." },
      { status: 403 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
    return NextResponse.json(
      { error: "Choose an image file no larger than 25 MB." },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Upload must use a valid multipart form." },
      { status: 400 },
    );
  }
  const researchSessionId = formData.get("researchSessionId");
  const ideaId = formData.get("ideaId");
  const image = formData.get("image");
  if (
    typeof researchSessionId !== "string" ||
    researchSessionId.trim().length === 0 ||
    researchSessionId.length > 100 ||
    typeof ideaId !== "string" ||
    ideaId.trim().length === 0 ||
    ideaId.length > 100 ||
    !(image instanceof File)
  ) {
    return NextResponse.json(
      { error: "A research session, selected idea, and image file are required." },
      { status: 422 },
    );
  }
  if (image.size === 0 || image.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Choose an image file no larger than 25 MB." },
      { status: 413 },
    );
  }
  if (!ACCEPTED_IMAGE_TYPES.has(image.type)) {
    return NextResponse.json(
      { error: "Upload a PNG, JPEG, or WebP image." },
      { status: 415 },
    );
  }

  try {
    const saved = await saveGeneratedImage(
      researchSessionId,
      ideaId,
      Buffer.from(await image.arrayBuffer()),
    );
    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof ImageGenerationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status ?? 400 },
      );
    }
    console.error("Could not save uploaded pin image", error);
    return NextResponse.json(
      { error: "The image could not be saved." },
      { status: 500 },
    );
  }
}
