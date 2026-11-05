import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const sessionIdSchema = z.string().trim().min(1).max(100);

function failureMessage(validationJson: string | null): string | null {
  if (!validationJson) return null;
  try {
    const value: unknown = JSON.parse(validationJson);
    if (
      typeof value === "object" &&
      value !== null &&
      "message" in value &&
      typeof value.message === "string"
    ) {
      return value.message;
    }
  } catch {
    return "Image validation details could not be read.";
  }
  return null;
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("researchSessionId");
  const parsedId = sessionIdSchema.safeParse(sessionId);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "A valid research session ID is required." },
      { status: 422 },
    );
  }

  const session = await prisma.researchSession.findUnique({
    where: { id: parsedId.data },
    select: {
      id: true,
      execution: {
        select: {
          id: true,
          selectedIdeas: {
            where: { selected: true },
            orderBy: { rank: "asc" },
            select: {
              rank: true,
              idea: {
                select: {
                  id: true,
                  title: true,
                  contentPackage: {
                    select: {
                      id: true,
                      pinterestTitle: true,
                      imagePrompt: true,
                      generationStatus: true,
                      assets: {
                        orderBy: { createdAt: "desc" },
                        take: 1,
                        select: {
                          id: true,
                          status: true,
                          mimeType: true,
                          width: true,
                          height: true,
                          sizeBytes: true,
                          validationJson: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!session) {
    return NextResponse.json({ error: "Research session was not found." }, { status: 404 });
  }

  return NextResponse.json({
    researchSessionId: session.id,
    executionId: session.execution.id,
    images: session.execution.selectedIdeas.map(({ rank, idea }) => {
      const content = idea.contentPackage;
      const asset = content?.assets[0] ?? null;
      return {
        ideaId: idea.id,
        ideaTitle: idea.title,
        rank,
        contentPackageId: content?.id ?? null,
        pinterestTitle: content?.pinterestTitle ?? null,
        imagePrompt: content?.imagePrompt ?? null,
        contentStatus: content?.generationStatus ?? "Missing",
        asset: asset
          ? {
              id: asset.id,
              status: asset.status,
              mimeType: asset.mimeType,
              width: asset.width,
              height: asset.height,
              sizeBytes: asset.sizeBytes?.toString() ?? null,
              imageUrl:
                asset.status === "Complete"
                  ? `/api/images/assets/${encodeURIComponent(asset.id)}`
                  : null,
              errorMessage:
                asset.status === "Failed"
                  ? failureMessage(asset.validationJson)
                  : null,
            }
          : null,
      };
    }),
  });
}
