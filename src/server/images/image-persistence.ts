import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeStorageFile } from "@/server/storage/local-storage";
import { validateAndNormalizeImage } from "./image-validation";

type Database = Pick<
  PrismaClient,
  "researchSession" | "generatedAsset" | "executionLog"
>;
export type ImageSource =
  | "gemini-assisted"
  | "user-upload"
  | "huggingface-inference";

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly category: "research" | "content" | "upload" | "persistence",
    readonly status?: number,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

export interface GeneratedImageClaim {
  executionId: string;
  ideaId: string;
  packageId: string;
  relativePath: string;
  assetId: string;
  title?: string;
}

/**
 * Creates a clean, filesystem-safe slug from a pin title or idea title.
 */
export function createSlug(text: string): string {
  const clean = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return clean || "pinterest-pin";
}

function assetRelativePath(
  executionId: string,
  packageId: string,
  title?: string,
): string {
  for (const id of [executionId, packageId]) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      throw new ImageGenerationError(
        "A selected image has an invalid storage identity.",
        "persistence",
      );
    }
  }
  const slug = title ? createSlug(title) : "";
  const filename = slug ? `${slug}-${packageId.slice(-6)}` : packageId;
  return `images/${executionId}/${filename}.webp`;
}

/**
 * Fetches the image prompt and title for a selected idea without claiming any asset row.
 */
export async function getImagePromptForIdea(
  researchSessionId: string,
  ideaId: string,
  database: Database = prisma,
): Promise<{
  imagePrompt: string;
  packageId: string;
  executionId: string;
  title: string;
}> {
  const target = await selectedImageTarget(researchSessionId, ideaId, database);
  return {
    imagePrompt: target.imagePrompt,
    packageId: target.packageId,
    executionId: target.executionId,
    title: target.title,
  };
}

async function selectedImageTarget(
  researchSessionId: string,
  ideaId: string,
  database: Database,
) {
  const session = await database.researchSession.findUnique({
    where: { id: researchSessionId },
    select: {
      id: true,
      status: true,
      executionId: true,
      execution: {
        select: {
          selectedIdeas: {
            where: { selected: true },
            select: {
              idea: {
                select: {
                  id: true,
                  title: true,
                  validationStatus: true,
                  contentPackage: {
                    select: {
                      id: true,
                      pinterestTitle: true,
                      imagePrompt: true,
                      generationStatus: true,
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
  if (!session || session.status !== "Complete") {
    throw new ImageGenerationError(
      "Complete research is required before generating pin images.",
      "research",
      409,
    );
  }
  const selectedIdea = session.execution.selectedIdeas
    .map(({ idea }) => idea)
    .find((idea) => idea.id === ideaId && idea.validationStatus === "Valid");
  if (
    !selectedIdea?.contentPackage ||
    selectedIdea.contentPackage.generationStatus !== "Complete" ||
    !selectedIdea.contentPackage.imagePrompt
  ) {
    throw new ImageGenerationError(
      "Images can only be generated for selected ideas with complete content packages.",
      "content",
      409,
    );
  }
  return {
    executionId: session.executionId,
    ideaId,
    packageId: selectedIdea.contentPackage.id,
    imagePrompt: selectedIdea.contentPackage.imagePrompt,
    title: selectedIdea.contentPackage.pinterestTitle || selectedIdea.title,
  };
}

export async function prepareGeneratedImage(
  researchSessionId: string,
  ideaId: string,
  database: Database = prisma,
): Promise<GeneratedImageClaim & { imagePrompt: string }> {
  const target = await selectedImageTarget(researchSessionId, ideaId, database);
  const relativePath = assetRelativePath(
    target.executionId,
    target.packageId,
    target.title,
  );

  // Check for an existing asset either by contentPackageId or relativePath
  const existing =
    (await database.generatedAsset.findFirst({
      where: { contentPackageId: target.packageId },
      select: { id: true, status: true, relativePath: true },
    })) ||
    (await database.generatedAsset.findUnique({
      where: { relativePath },
      select: { id: true, status: true, relativePath: true },
    }));

  if (existing?.status === "Generating" || existing?.status === "Queued") {
    throw new ImageGenerationError(
      "This image is already being generated or saved. Wait for it to finish.",
      "content",
      409,
    );
  }

  let assetId: string;
  if (existing) {
    const claimed = await database.generatedAsset.updateMany({
      where: { id: existing.id, status: existing.status },
      data: {
        status: "Generating",
        relativePath,
        validationJson: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ImageGenerationError(
        "This image changed while generation was starting. Please retry.",
        "content",
        409,
      );
    }
    assetId = existing.id;
  } else {
    try {
      const created = await database.generatedAsset.create({
        data: {
          executionId: target.executionId,
          contentPackageId: target.packageId,
          relativePath,
          status: "Generating",
        },
        select: { id: true },
      });
      assetId = created.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ImageGenerationError(
          "This image changed while generation was starting. Please retry.",
          "content",
          409,
        );
      }
      throw error;
    }
  }

  return {
    executionId: target.executionId,
    ideaId: target.ideaId,
    packageId: target.packageId,
    relativePath,
    assetId,
    imagePrompt: target.imagePrompt,
    title: target.title,
  };
}

export async function markGeneratedImageFailed(
  claim: GeneratedImageClaim,
  message: string,
  source: ImageSource = "gemini-assisted",
  database: Database = prisma,
): Promise<void> {
  await database.generatedAsset.update({
    where: { id: claim.assetId },
    data: {
      status: "Failed",
      validationJson: JSON.stringify({ message, source }),
    },
  });
  await database.executionLog.create({
    data: {
      executionId: claim.executionId,
      stage: "ImageGeneration",
      event: "image_generation_failed",
      message: `Image generation failed for selected idea ${claim.ideaId}: ${message}`,
      metadataJson: JSON.stringify({ ideaId: claim.ideaId, source }),
    },
  });
}

export async function saveGeneratedImage(
  researchSessionId: string,
  ideaId: string,
  image: Buffer,
  database: Database = prisma,
  source: ImageSource = "user-upload",
  existingClaim?: GeneratedImageClaim,
): Promise<{ status: "Complete"; assetId: string }> {
  const claim = existingClaim;
  let validated: Awaited<ReturnType<typeof validateAndNormalizeImage>>;
  try {
    validated = await validateAndNormalizeImage(image, (contents) =>
      createHash("sha256").update(contents).digest("hex"),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The image is invalid.";
    if (claim) {
      await markGeneratedImageFailed(claim, message, source, database);
    }
    throw new ImageGenerationError(
      message,
      source === "user-upload" ? "upload" : "persistence",
      source === "user-upload" ? 422 : 502,
    );
  }

  const imageClaim =
    claim ??
    (await prepareGeneratedImage(researchSessionId, ideaId, database));
  try {
    // 1. Write the primary WebP asset file in the execution subfolder with relevant name
    await writeStorageFile(imageClaim.relativePath, validated.contents);

    // 2. Also save a clean, direct copy in storage/images/<slug>.webp for clear visibility
    const targetTitle =
      imageClaim.title ||
      (await selectedImageTarget(researchSessionId, ideaId, database)).title;
    if (targetTitle) {
      const cleanSlug = createSlug(targetTitle);
      try {
        await writeStorageFile(`images/${cleanSlug}.webp`, validated.contents);
      } catch (slugErr) {
        console.warn("Could not write clean root image copy", slugErr);
      }
    }

    // 3. Mark asset as Complete in database so Content library reflects it immediately
    await database.generatedAsset.update({
      where: { id: imageClaim.assetId },
      data: {
        status: "Complete",
        mimeType: "image/webp",
        format: validated.format,
        width: validated.width,
        height: validated.height,
        sizeBytes: BigInt(validated.sizeBytes),
        sha256: validated.sha256,
        validationJson: JSON.stringify({
          status: "valid",
          source,
          minimumSide: 512,
          normalizedFormat: validated.format,
        }),
      },
    });

    await database.executionLog.create({
      data: {
        executionId: imageClaim.executionId,
        stage: "ImageGeneration",
        event: source === "user-upload" ? "image_uploaded" : "image_generated",
        message:
          source === "user-upload"
            ? `Validated and saved the uploaded pin image for selected idea ${ideaId}.`
            : `Validated and saved the Gemini pin image for selected idea ${ideaId}.`,
        metadataJson: JSON.stringify({
          ideaId,
          width: validated.width,
          height: validated.height,
          sizeBytes: validated.sizeBytes,
          source,
        }),
      },
    });
    return { status: "Complete", assetId: imageClaim.assetId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The image could not be saved.";
    await markGeneratedImageFailed(imageClaim, message, source, database);
    throw new ImageGenerationError(
      message,
      "persistence",
      500,
    );
  }
}
