import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { validateAndNormalizeImage } from "./image-validation";

const sha256 = (contents: Buffer) =>
  createHash("sha256").update(contents).digest("hex");

describe("validateAndNormalizeImage", () => {
  it("normalizes a valid raster image and reports dimensions and digest", async () => {
    const image = await sharp({
      create: {
        width: 900,
        height: 1200,
        channels: 3,
        background: "#2d7159",
      },
    })
      .png()
      .toBuffer();

    const result = await validateAndNormalizeImage(image, sha256);

    expect(result).toMatchObject({
      width: 900,
      height: 1200,
      format: "webp",
      sizeBytes: result.contents.length,
      sha256: sha256(result.contents),
    });
    expect((await sharp(result.contents).metadata()).format).toBe("webp");
  });

  it("rejects undecodable, undersized, and oversized input", async () => {
    await expect(validateAndNormalizeImage(Buffer.from("not an image"), sha256))
      .rejects.toThrow("unreadable or unsupported");

    const tiny = await sharp({
      create: {
        width: 400,
        height: 600,
        channels: 3,
        background: "#fff",
      },
    })
      .png()
      .toBuffer();
    await expect(validateAndNormalizeImage(tiny, sha256)).rejects.toThrow(
      "minimum raster format",
    );
    await expect(
      validateAndNormalizeImage(Buffer.alloc(25 * 1024 * 1024 + 1), sha256),
    ).rejects.toThrow("file-size range");
  });
});
