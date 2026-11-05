import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  openGeminiBrowser,
  getPlaywrightBrowserStatus,
} from "@/server/browser/playwright-service";

export const runtime = "nodejs";

const requestSchema = z.object({
  prompt: z.string().trim().max(10_000).optional(),
});

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid browser open parameters." }, { status: 422 });
  }

  try {
    const result = await openGeminiBrowser({ prompt: parsed.data.prompt });
    return NextResponse.json({
      ok: true,
      opened: result.opened,
      url: result.url,
      message: "Gemini opened in browser with persistent profile.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open Gemini in browser.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  const status = await getPlaywrightBrowserStatus();
  return NextResponse.json(status);
}

