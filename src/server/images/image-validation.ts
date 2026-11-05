import sharp, { type Metadata } from "sharp";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 20_000_000;
const MIN_IMAGE_SIDE = 512;

export interface ValidatedImage {
  contents: Buffer;
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  format: "webp";
}

export async function validateAndNormalizeImage(
  input: Buffer,
  sha256: (contents: Buffer) => string,
): Promise<ValidatedImage> {
  if (input.length === 0 || input.length > MAX_IMAGE_BYTES) {
    throw new Error("The image is outside the allowed file-size range.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new Error("The image is unreadable or unsupported.");
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width < MIN_IMAGE_SIDE ||
    metadata.height < MIN_IMAGE_SIDE ||
    !["jpeg", "png", "webp"].includes(metadata.format ?? "")
  ) {
    throw new Error(
      "The image does not meet the minimum raster format and dimension requirements.",
    );
  }

  let contents: Buffer;
  try {
    contents = await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_IMAGE_PIXELS,
    })
      .rotate()
      .webp({ quality: 90 })
      .toBuffer();
  } catch {
    throw new Error("The generated image could not be normalized for storage.");
  }
  if (contents.length > MAX_IMAGE_BYTES) {
    throw new Error("The normalized image exceeds the allowed file-size range.");
  }
  const normalizedMetadata = await sharp(contents).metadata();
  if (!normalizedMetadata.width || !normalizedMetadata.height) {
    throw new Error("The normalized image has invalid dimensions.");
  }
  return {
    contents,
    width: normalizedMetadata.width,
    height: normalizedMetadata.height,
    sizeBytes: contents.length,
    sha256: sha256(contents),
    format: "webp",
  };
}
