import { readFile, unlink } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveStoragePath } from "@/server/storage/local-storage";
import { createSlug } from "@/server/images/image-persistence";
import { hasSameOrigin } from "@/server/security/request-origin";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(assetId)) {
    return NextResponse.json({ error: "Invalid image ID." }, { status: 400 });
  }
  const asset = await prisma.generatedAsset.findUnique({
    where: { id: assetId },
    select: { status: true, mimeType: true, relativePath: true },
  });
  if (!asset || asset.status !== "Complete") {
    return NextResponse.json({ error: "Image was not found." }, { status: 404 });
  }

  try {
    const contents = await readFile(resolveStoragePath(asset.relativePath));
    return new NextResponse(new Uint8Array(contents), {
      headers: {
        "content-type": asset.mimeType ?? "application/octet-stream",
        "content-length": String(contents.length),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      },
    });
  } catch (error) {
    console.error("Could not read persisted image asset", {
      assetId,
      message: error instanceof Error ? error.message : "Unknown storage error.",
    });
    return NextResponse.json(
      { error: "The saved image file is unavailable." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json(
      { error: "Request origin rejected." },
      { status: 403 },
    );
  }

  const { assetId } = await params;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(assetId)) {
    return NextResponse.json({ error: "Invalid image ID." }, { status: 400 });
  }

  const asset = await prisma.generatedAsset.findUnique({
    where: { id: assetId },
    select: {
      id: true,
      executionId: true,
      relativePath: true,
      contentPackage: {
        select: {
          id: true,
          pinterestTitle: true,
          idea: { select: { id: true, title: true } },
        },
      },
    },
  });

  if (!asset) {
    return NextResponse.json(
      { error: "Image asset was not found." },
      { status: 404 },
    );
  }

  // Attempt to delete primary file on disk
  try {
    const absolutePath = resolveStoragePath(asset.relativePath);
    await unlink(absolutePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("Could not delete primary asset file", err);
    }
  }

  // Attempt to delete clean root copy if it exists
  const title =
    asset.contentPackage?.pinterestTitle || asset.contentPackage?.idea?.title;
  if (title) {
    try {
      const cleanSlug = createSlug(title);
      const rootPath = resolveStoragePath(`images/${cleanSlug}.webp`);
      await unlink(rootPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("Could not delete root copy file", err);
      }
    }
  }

  // Delete database record
  await prisma.generatedAsset.delete({
    where: { id: assetId },
  });

  // Log execution event
  try {
    await prisma.executionLog.create({
      data: {
        executionId: asset.executionId,
        stage: "ImageGeneration",
        event: "image_removed",
        message: `Removed image asset ${assetId}.`,
        metadataJson: JSON.stringify({
          assetId,
          relativePath: asset.relativePath,
          contentPackageId: asset.contentPackage?.id,
        }),
      },
    });
  } catch (logErr) {
    console.warn("Could not write execution log for image removal", logErr);
  }

  return NextResponse.json({ ok: true, message: "Image removed successfully." });
}
