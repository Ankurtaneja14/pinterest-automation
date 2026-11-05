"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
  Images,
  LoaderCircle,
  Send,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { z } from "zod";

const targetSchema = z.object({
  researchSessionId: z.string(),
  niche: z.string(),
  targetCountry: z.string(),
  targetAudience: z.string(),
});

const imageSchema = z.object({
  ideaId: z.string(),
  ideaTitle: z.string(),
  rank: z.number(),
  contentPackageId: z.string().nullable(),
  pinterestTitle: z.string().nullable(),
  imagePrompt: z.string().nullable(),
  contentStatus: z.string(),
  asset: z
    .object({
      id: z.string(),
      status: z.string(),
      mimeType: z.string().nullable(),
      width: z.number().nullable(),
      height: z.number().nullable(),
      sizeBytes: z.string().nullable(),
      imageUrl: z.string().nullable(),
      errorMessage: z.string().nullable(),
    })
    .nullable(),
});

const workspaceSchema = z.object({
  researchSessionId: z.string(),
  executionId: z.string(),
  images: z.array(imageSchema),
});

const errorSchema = z.object({ error: z.string() });

type Target = z.infer<typeof targetSchema>;
type Workspace = z.infer<typeof workspaceSchema>;

function apiError(payload: unknown, fallback: string): string {
  const parsed = errorSchema.safeParse(payload);
  return parsed.success ? parsed.data.error : fallback;
}

export function ImageWorkspace({
  targets: targetInput,
}: {
  targets: Target[];
}) {
  const targets = useMemo(
    () => targetInput.map((target) => targetSchema.parse(target)),
    [targetInput],
  );
  const [researchSessionId, setResearchSessionId] = useState(
    targets[0]?.researchSessionId ?? "",
  );
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(targets.length > 0);
  const [uploadingIdeaId, setUploadingIdeaId] = useState<string | null>(null);
  const [generatingIdeaId, setGeneratingIdeaId] = useState<string | null>(null);
  const [removingAssetId, setRemovingAssetId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [copiedIdeaId, setCopiedIdeaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    if (!researchSessionId) return null;
    const response = await fetch(
      `/api/images?researchSessionId=${encodeURIComponent(researchSessionId)}`,
      { cache: "no-store" },
    );
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(apiError(payload, "Could not load generated images."));
    }
    const parsed = workspaceSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("The server returned invalid image workspace data.");
    }
    return parsed.data;
  }, [researchSessionId]);

  const refreshWorkspace = useCallback(async () => {
    const data = await loadWorkspace();
    if (data) setWorkspace(data);
  }, [loadWorkspace]);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspace()
      .then((data) => {
        if (!cancelled && data) setWorkspace(data);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load generated images.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace]);

  async function copyPrompt(ideaId: string, prompt: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedIdeaId(ideaId);
      window.setTimeout(() => {
        setCopiedIdeaId((current) => (current === ideaId ? null : current));
      }, 2_000);
    } catch {
      setError(
        "Clipboard access was unavailable. Expand the prompt and copy its text manually.",
      );
    }
  }

  async function uploadImage(ideaId: string, file: File | undefined) {
    if (!file || uploadingIdeaId || generatingIdeaId || removingAssetId) return;
    setUploadingIdeaId(ideaId);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.set("researchSessionId", researchSessionId);
      formData.set("ideaId", ideaId);
      formData.set("image", file);
      const response = await fetch("/api/images/upload", {
        method: "POST",
        body: formData,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(apiError(payload, "Could not save this image."));
      }
      await refreshWorkspace();
      setNotice("Image saved and normalized to WebP.");
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not save this image.",
      );
    } finally {
      setUploadingIdeaId(null);
    }
  }

  async function requestImage(ideaId: string): Promise<boolean> {
    setGeneratingIdeaId(ideaId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/images/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ researchSessionId, ideaId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(apiError(payload, "Could not prepare image generation."));
      }
      await refreshWorkspace();
      setNotice("Image generated and saved successfully.");
      return true;
    } catch (generationError) {
      const message =
        generationError instanceof Error
          ? generationError.message
          : "Could not generate this image.";
      setError(message);
      try {
        await refreshWorkspace();
      } catch {
        setError(`${message} The image status could not be refreshed.`);
      }
      return false;
    } finally {
      setGeneratingIdeaId(null);
    }
  }

  async function removeImage(assetId: string) {
    if (removingAssetId || generatingIdeaId || uploadingIdeaId || batchProgress !== null) {
      return;
    }
    setRemovingAssetId(assetId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/images/assets/${encodeURIComponent(assetId)}`,
        { method: "DELETE" },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(apiError(payload, "Could not remove this image."));
      }
      await refreshWorkspace();
      setNotice("Image removed successfully.");
    } catch (removeError) {
      setError(
        removeError instanceof Error
          ? removeError.message
          : "Could not remove this image.",
      );
    } finally {
      setRemovingAssetId(null);
    }
  }

  async function generateAllImages() {
    if (!workspace || generatingIdeaId || uploadingIdeaId || removingAssetId) return;
    const pending = workspace.images.filter(
      (item) =>
        item.contentStatus === "Complete" &&
        item.imagePrompt &&
        item.asset?.status !== "Complete" &&
        item.asset?.status !== "Generating" &&
        item.asset?.status !== "Queued",
    );
    if (pending.length === 0) {
      setNotice("All selected ideas already have generated images.");
      setError(null);
      return;
    }

    setBatchProgress({ completed: 0, total: pending.length });
    setError(null);
    let failed = 0;
    for (let index = 0; index < pending.length; index += 1) {
      if (!(await requestImage(pending[index].ideaId))) failed += 1;
      setBatchProgress({ completed: index + 1, total: pending.length });
    }
    setBatchProgress(null);
    if (failed > 0) {
      setError(
        `${failed} of ${pending.length} images could not be generated. Review the affected cards and retry.`,
      );
    } else {
      setNotice(`Generated ${pending.length} image${pending.length === 1 ? "" : "s"}.`);
    }
  }

  if (targets.length === 0) {
    return (
      <section className="panel image-empty-panel">
        <Images size={22} />
        <strong>No selected content is ready for images</strong>
        <span>
          Generate and score ideas, then create complete content packages before
          adding images.
        </span>
        <a className="secondary-button" href="/ideas">
          Open content ideas
        </a>
      </section>
    );
  }

  const selectedTarget = targets.find(
    (target) => target.researchSessionId === researchSessionId,
  );

  return (
    <div className="image-workspace">
      <section className="panel image-setup-panel">
        <div className="panel-heading">
          <div>
            <h2>Gemini image generation</h2>
            <p>
              Automates image generation directly in Google Gemini using your
              local Chrome browser session.
            </p>
          </div>
          <span className="metric-icon">
            <Sparkles size={17} />
          </span>
        </div>
        <p className="image-safety-note">
          Images generated via Gemini are automatically downloaded, validated,
          converted to WebP, and saved to your local storage.
        </p>
      </section>

      <section className="panel image-control-panel">
        <div className="panel-heading">
          <div>
            <h2>Selected pin images</h2>
            <p>
              Generate images automatically from each completed content
              package. Results are validated, normalized to WebP, and stored
              locally. Manual upload remains available as a fallback.
            </p>
          </div>
          <span className="metric-icon">
            <Images size={17} />
          </span>
        </div>
        <div className="image-controls">
          <label>
            Research schedule
            <select
              className="research-select"
              value={researchSessionId}
              onChange={(event) => {
                setLoading(true);
                setWorkspace(null);
                setResearchSessionId(event.currentTarget.value);
                setError(null);
              }}
            >
              {targets.map((target) => (
                <option
                  key={target.researchSessionId}
                  value={target.researchSessionId}
                >
                  {target.niche} · {target.targetCountry} · {target.targetAudience}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedTarget ? (
          <p className="image-selection-note">
            {selectedTarget.niche} · {selectedTarget.targetCountry} ·{" "}
            {selectedTarget.targetAudience}
          </p>
        ) : null}
        <div className="image-batch-actions">
          <button
            className="primary-button"
            type="button"
            disabled={
              loading ||
              !workspace ||
              generatingIdeaId !== null ||
              uploadingIdeaId !== null ||
              removingAssetId !== null ||
              batchProgress !== null
            }
            onClick={() => void generateAllImages()}
          >
            {batchProgress ? (
              <LoaderCircle size={15} className="spinning" />
            ) : (
              <Sparkles size={15} />
            )}
            {batchProgress
              ? `Generating ${batchProgress.completed}/${batchProgress.total}…`
              : "Generate all missing images"}
          </button>
          <a className="secondary-button" href="/pinterest/publish">
            <Send size={15} />
            <span>Open Publishing Center</span>
          </a>
        </div>
      </section>

      {error ? (
        <div className="workspace-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="feedback-message feedback-success" role="status">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      ) : null}

      {loading ? (
        <section className="panel image-empty-panel" aria-live="polite">
          <LoaderCircle size={18} className="spinning" />
          <span>Loading selected content…</span>
        </section>
      ) : workspace?.images.length ? (
        <section className="image-gallery" aria-label="Selected pin images">
          {workspace.images.map((item) => {
            const asset = item.asset;
            const status = asset?.status ?? "Not generated";
            const previousErrorMessage = asset?.errorMessage;
            const uploadId = `image-upload-${item.ideaId}`;
            return (
              <article className="panel image-card" key={item.ideaId}>
                <div className="image-card-heading">
                  <span className="idea-index">{item.rank}</span>
                  <div>
                    <span className="eyebrow">SELECTED IDEA</span>
                    <h3>{item.pinterestTitle ?? item.ideaTitle}</h3>
                  </div>
                  <span
                    className={`image-status image-status-${status
                      .toLowerCase()
                      .replaceAll(" ", "-")}`}
                  >
                    {status === "Complete" ? (
                      <CheckCircle2 size={13} />
                    ) : status === "Generating" ? (
                      <LoaderCircle size={13} className="spinning" />
                    ) : (
                      <AlertCircle size={13} />
                    )}
                    {status}
                  </span>
                </div>
                {asset?.imageUrl ? (
                  <div className="generated-image-frame">
                    <Image
                      src={asset.imageUrl}
                      alt={`Generated Pinterest pin for ${
                        item.pinterestTitle ?? item.ideaTitle
                      }`}
                      width={asset.width ?? 900}
                      height={asset.height ?? 1200}
                      unoptimized
                    />
                  </div>
                ) : null}
                {previousErrorMessage ? (
                  <div className="image-error-message" role="status">
                    <AlertCircle size={14} />
                    <span>
                      Previous attempt failed: {previousErrorMessage} Open Gemini
                      again, generate a new image, and upload it here.
                    </span>
                  </div>
                ) : null}
                <div className="image-card-actions">
                  <button
                    className="primary-button"
                    type="button"
                    disabled={
                      generatingIdeaId !== null ||
                      uploadingIdeaId !== null ||
                      removingAssetId !== null ||
                      batchProgress !== null ||
                      item.contentStatus !== "Complete" ||
                      !item.imagePrompt
                    }
                    onClick={() => void requestImage(item.ideaId)}
                  >
                    {generatingIdeaId === item.ideaId ? (
                      <LoaderCircle size={14} className="spinning" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    {generatingIdeaId === item.ideaId
                      ? "Generating image…"
                      : asset?.status === "Complete"
                        ? "Regenerate image"
                        : "Generate image"}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      !item.imagePrompt ||
                      generatingIdeaId !== null ||
                      removingAssetId !== null ||
                      batchProgress !== null
                    }
                    onClick={() =>
                      item.imagePrompt &&
                      void copyPrompt(item.ideaId, item.imagePrompt)
                    }
                  >
                    <Clipboard size={14} />
                    {copiedIdeaId === item.ideaId
                      ? "Prompt copied"
                      : "Copy image prompt"}
                  </button>
                  <input
                    id={uploadId}
                    className="image-file-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={
                      uploadingIdeaId !== null ||
                      generatingIdeaId !== null ||
                      removingAssetId !== null ||
                      batchProgress !== null ||
                      !item.contentPackageId
                    }
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      void uploadImage(item.ideaId, file);
                    }}
                  />
                  <label
                    className="secondary-button image-upload-button"
                    htmlFor={uploadId}
                  >
                    {uploadingIdeaId === item.ideaId ? (
                      <LoaderCircle size={14} className="spinning" />
                    ) : (
                      <Upload size={14} />
                    )}
                    {uploadingIdeaId === item.ideaId
                      ? "Saving image…"
                      : asset?.status === "Complete"
                        ? "Replace image"
                        : "Upload generated image"}
                  </label>
                  {asset?.id ? (
                    <button
                      className="secondary-button image-remove-button"
                      type="button"
                      disabled={
                        removingAssetId !== null ||
                        generatingIdeaId !== null ||
                        uploadingIdeaId !== null ||
                        batchProgress !== null
                      }
                      onClick={() => void removeImage(asset.id)}
                    >
                      {removingAssetId === asset.id ? (
                        <LoaderCircle size={14} className="spinning" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      {removingAssetId === asset.id ? "Removing…" : "Remove image"}
                    </button>
                  ) : null}
                </div>
                {asset?.imageUrl ? (
                  <div className="image-card-links" style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                    <a
                      className="secondary-button image-download-link"
                      href={asset.imageUrl}
                      download={`${item.pinterestTitle ?? "pinterest-pin"}.webp`}
                    >
                      <Download size={14} />
                      Download WebP
                    </a>
                    <a
                      className="primary-button"
                      href="/pinterest/publish"
                      style={{ minHeight: "36px", padding: "0 12px", textDecoration: "none" }}
                    >
                      <Send size={14} />
                      Send to Publishing
                    </a>
                  </div>
                ) : null}
                <details className="image-prompt-details">
                  <summary>View image prompt</summary>
                  <p>{item.imagePrompt ?? "No image prompt is available."}</p>
                </details>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="panel image-empty-panel">
          <Images size={20} />
          <span>No selected ideas are available for this research session.</span>
        </section>
      )}
    </div>
  );
}
