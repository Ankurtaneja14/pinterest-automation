import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasSameOrigin } from "@/server/security/request-origin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const packages = await prisma.contentPackage.findMany({
      where: {
        generationStatus: "Complete",
        assets: {
          some: {
            status: "Complete",
          },
        },
      },
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        contentId: true,
        pinterestTitle: true,
        description: true,
        destinationUrl: true,
        imagePrompt: true,
        generatedAt: true,
        idea: {
          select: {
            id: true,
            title: true,
            execution: {
              select: {
                schedule: {
                  select: {
                    niche: true,
                    targetCountry: true,
                  },
                },
              },
            },
          },
        },
        assets: {
          where: { status: "Complete" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            relativePath: true,
            width: true,
            height: true,
          },
        },
      },
    });

    const items = packages.map((pkg) => {
      const asset = pkg.assets[0];
      return {
        id: pkg.id,
        contentId: pkg.contentId,
        pinterestTitle: pkg.pinterestTitle,
        description: pkg.description,
        destinationUrl: pkg.destinationUrl,
        imagePrompt: pkg.imagePrompt,
        generatedAt: pkg.generatedAt,
        niche: pkg.idea.execution.schedule.niche,
        targetCountry: pkg.idea.execution.schedule.targetCountry,
        asset: asset
          ? {
              id: asset.id,
              imageUrl: `/api/images/assets/${encodeURIComponent(asset.id)}`,
              width: asset.width,
              height: asset.height,
            }
          : null,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not fetch content library." },
      { status: 500 },
    );
  }
}

