"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Lightbulb,
  LoaderCircle,
  PackageCheck,
  Sparkles,
} from "lucide-react";
import { z } from "zod";

const targetSchema = z.object({
  scheduleId: z.string(),
  researchSessionId: z.string(),
  niche: z.string(),
  targetCountry: z.string(),
  targetAudience: z.string(),
  language: z.string(),
  requestedCount: z.number().int().positive(),
});

const ideaSchema = z.object({
  id: z.string(),
  title: z.string(),
  coreConcept: z.string(),
  explanation: z.string(),
  audienceSegment: z.string(),
  audienceNeed: z.string(),
  searchIntent: z.string(),
  keywords: z.array(z.string()),
  rationale: z.string(),
  visualDirection: z.string(),
  contentFormat: z.string(),
  trendClassification: z.string(),
  destinationRelevance: z.string(),
  sourceIds: z.array(z.string()),
  validationStatus: z.string(),
  createdAt: z.string(),
  score: z.object({
    trendRelevance: z.number(),
    audienceResonance: z.number(),
    searchPotential: z.number(),
    clickPotential: z.number(),
    visualAppeal: z.number(),
    originality: z.number(),
    evergreenValue: z.number(),
    finalScore: z.number(),
    reasoning: z.string(),
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    improvementSuggestions: z.array(z.string()),
  }).nullable(),
  selection: z.object({
    rank: z.number(),
    selected: z.boolean(),
    reason: z.string().nullable(),
  }).nullable(),
  contentPackage: z.object({
    contentId: z.string(),
    pinterestTitle: z.string(),
    description: z.string(),
    hashtags: z.array(z.string()),
    keywords: z.array(z.string()),
    imagePrompt: z.string(),
    destinationUrl: z.string().url(),
    generationStatus: z.string(),
  }).nullable(),
});

const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceUrl: z.string().url(),
});

const workspaceSchema = z.object({
  schedule: z.object({
    id: z.string(),
    niche: z.string(),
    targetCountry: z.string(),
    targetAudience: z.string(),
    language: z.string(),
    researchIdeasCount: z.number().int(),
    pinsToGenerate: z.number().int(),
    destinationUrl: z.string().url(),
  }),
  researchSessionId: z.string(),
  generationStatus: z.string(),
  errorCategory: z.string().nullable(),
  errorMessage: z.string().nullable(),
  sources: z.array(sourceSchema),
  ideas: z.array(ideaSchema),
});

const errorSchema = z.object({ error: z.string() });

type Target = z.infer<typeof targetSchema>;
type Workspace = z.infer<typeof workspaceSchema>;

function messageFrom(payload: unknown, fallback: string): string {
  const parsed = errorSchema.safeParse(payload);
  return parsed.success ? parsed.data.error : fallback;
}

export function IdeaWorkspace({ targets: targetInput }: { targets: Target[] }) {
  const targets = useMemo(
    () => targetInput.map((target) => targetSchema.parse(target)),
    [targetInput],
  );
  const [scheduleId, setScheduleId] = useState(targets[0]?.scheduleId ?? "");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(targets.length > 0);
  const [busy, setBusy] = useState(false);
  const [scoringBusy, setScoringBusy] = useState(false);
  const [contentBusy, setContentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTarget = targets.find((target) => target.scheduleId === scheduleId);

  const loadWorkspace = useCallback(async () => {
    if (!scheduleId) {
      return null;
    }
    const response = await fetch(
      `/api/ideas?scheduleId=${encodeURIComponent(scheduleId)}`,
      { cache: "no-store" },
    );
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(messageFrom(payload, "Could not load generated ideas."));
    }
    const parsed = workspaceSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("The server returned invalid idea workspace data.");
    }
    return parsed.data;
  }, [scheduleId]);

  useEffect(() => {
    let cancelled = false;
    void loadWorkspace()
      .then((data) => {
        if (!cancelled && data) {
          setWorkspace(data);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load generated ideas.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadWorkspace]);

  useEffect(() => {
    if (
      workspace?.generationStatus !== "IdeasGenerating" &&
      workspace?.generationStatus !== "Scoring" &&
      workspace?.generationStatus !== "ContentGenerating"
    ) {
      return;
    }
    const interval = setInterval(() => {
      void loadWorkspace()
        .then((data) => {
          if (data) {
            setWorkspace(data);
            setError(null);
          }
        })
        .catch((loadError: unknown) => {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not refresh idea generation status.",
          );
        });
    }, 2_000);
    return () => clearInterval(interval);
  }, [loadWorkspace, workspace?.generationStatus]);

  async function generateIdeas() {
    if (!scheduleId || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduleId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(messageFrom(payload, "Could not start idea generation."));
      }
      const data = await loadWorkspace();
      if (data) {
        setWorkspace(data);
      }
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Could not start idea generation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function scoreIdeas() {
    if (!workspace || scoringBusy) {
      return;
    }
    setScoringBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/ideas/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ researchSessionId: workspace.researchSessionId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(messageFrom(payload, "Could not start idea scoring."));
      }
      const data = await loadWorkspace();
      if (data) {
        setWorkspace(data);
      }
    } catch (scoringError) {
      setError(
        scoringError instanceof Error
          ? scoringError.message
          : "Could not start idea scoring.",
      );
    } finally {
      setScoringBusy(false);
    }
  }

  async function generatePinContent() {
    if (!workspace || contentBusy) {
      return;
    }
    setContentBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ researchSessionId: workspace.researchSessionId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(messageFrom(payload, "Could not start content generation."));
      }
      const data = await loadWorkspace();
      if (data) {
        setWorkspace(data);
      }
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Could not start content generation.",
      );
    } finally {
      setContentBusy(false);
    }
  }

  if (targets.length === 0) {
    return (
      <section className="panel idea-empty-panel">
        <Lightbulb size={22} />
        <strong>Complete research to generate ideas</strong>
        <span>
          Import a schedule, run research, then return here to generate its
          requested number of cited content ideas.
        </span>
        <a className="secondary-button" href="/research">Open research</a>
      </section>
    );
  }

  const existingCount = workspace?.ideas.length ?? 0;
  const requestedCount =
    workspace?.schedule.researchIdeasCount ?? selectedTarget?.requestedCount ?? 0;
  const requestedPins = workspace?.schedule.pinsToGenerate ?? 0;
  const complete = existingCount >= requestedCount;
  const generating = workspace?.generationStatus === "IdeasGenerating";
  const scoring = workspace?.generationStatus === "Scoring";
  const scoresReady =
    workspace !== null &&
    workspace.ideas.length > 0 &&
    workspace.ideas.every((idea) => idea.score !== null && idea.selection !== null);
  const selectedCount =
    workspace?.ideas.filter((idea) => idea.selection?.selected).length ?? 0;
  const generatedPackageCount =
    workspace?.ideas.filter(
      (idea) =>
        idea.selection?.selected &&
        idea.contentPackage?.generationStatus === "Complete",
    ).length ?? 0;
  const contentReady =
    selectedCount > 0 && generatedPackageCount === selectedCount;
  const contentGenerating =
    workspace?.generationStatus === "ContentGenerating";
  const sourcesById = new Map(
    (workspace?.sources ?? []).map((source) => [source.id, source]),
  );
  const orderedIdeas = [...(workspace?.ideas ?? [])].sort((left, right) => {
    if (left.selection && right.selection) {
      return left.selection.rank - right.selection.rank;
    }
    if (left.selection) return -1;
    if (right.selection) return 1;
    return left.createdAt.localeCompare(right.createdAt);
  });

  return (
    <div className="idea-workspace">
      <section className="panel idea-control-panel">
        <div className="panel-heading">
          <div>
            <h2>Generate from completed research</h2>
            <p>Each idea includes an audience need, search intent, visual direction, and evidence citations.</p>
          </div>
          <span className="metric-icon"><Sparkles size={17} /></span>
        </div>
        <div className="idea-controls">
          <label>
            Schedule
            <select
              className="research-select"
              value={scheduleId}
              onChange={(event) => {
                setLoading(true);
                setWorkspace(null);
                setScheduleId(event.currentTarget.value);
                setError(null);
              }}
            >
              {targets.map((target) => (
                <option key={target.researchSessionId} value={target.scheduleId}>
                  {target.niche} · {target.targetCountry} · {target.targetAudience}
                </option>
              ))}
            </select>
          </label>
          <div className="idea-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!scheduleId || busy || generating || complete || loading || scoring}
              onClick={() => void generateIdeas()}
            >
              {busy || generating ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <Sparkles size={15} />
              )}
              {generating
                ? `Generating ideas (${existingCount}/${requestedCount})…`
                : complete
                  ? `All ${requestedCount} ideas generated`
                  : `Generate ${requestedCount - existingCount} ideas`}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!workspace?.ideas.length || scoringBusy || scoring || scoresReady || loading}
              onClick={() => void scoreIdeas()}
            >
              {scoringBusy || scoring ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <Sparkles size={15} />
              )}
              {scoring
                ? "Scoring ideas…"
                : scoresReady
                  ? `${selectedCount} of ${requestedPins} pins selected`
                  : "Score & select pins"}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={
                !scoresReady ||
                selectedCount === 0 ||
                contentBusy ||
                contentGenerating ||
                contentReady ||
                loading
              }
              onClick={() => void generatePinContent()}
            >
              {contentBusy || contentGenerating ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <PackageCheck size={15} />
              )}
              {contentGenerating
                ? `Writing content (${generatedPackageCount}/${selectedCount})…`
                : contentReady
                  ? `${generatedPackageCount} content packages ready`
                  : "Generate pin content"}
            </button>
          </div>
        </div>
        {selectedTarget && (
          <p className="field-note">
            {selectedTarget.language} · {requestedCount} ideas requested ·
            &nbsp;research evidence is retained with citations.
          </p>
        )}
        {workspace?.generationStatus === "IdeasFailed" && workspace.errorMessage && (
          <p className="feedback-message feedback-error" role="alert">
            <AlertCircle size={14} /> {workspace.errorMessage}
          </p>
        )}
        {workspace?.generationStatus === "ScoringFailed" && workspace.errorMessage && (
          <p className="feedback-message feedback-error" role="alert">
            <AlertCircle size={14} /> {workspace.errorMessage}
          </p>
        )}
        {workspace?.generationStatus === "ContentFailed" && workspace.errorMessage && (
          <p className="feedback-message feedback-error" role="alert">
            <AlertCircle size={14} /> {workspace.errorMessage}
          </p>
        )}
        {error && (
          <p className="feedback-message feedback-error" role="alert">
            <AlertCircle size={14} /> {error}
          </p>
        )}
      </section>

      {loading ? (
        <div className="settings-loading">
          <LoaderCircle size={17} className="spinning" />
          Loading ideas…
        </div>
      ) : workspace?.ideas.length ? (
        <section className="idea-list" aria-label="Generated content ideas">
          {orderedIdeas.map((idea, index) => (
            <article className="panel idea-card" key={idea.id}>
              <div className="idea-card-heading">
                <span className="idea-index">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <h2>{idea.title}</h2>
                  <span>{idea.contentFormat} · {idea.searchIntent} · {idea.trendClassification}</span>
                </div>
                {idea.score && (
                  <span className={`idea-score-badge${idea.selection?.selected ? " is-selected" : ""}`}>
                    {idea.score.finalScore.toFixed(1)}
                    {idea.selection?.selected ? ` · SELECTED #${idea.selection.rank}` : ""}
                  </span>
                )}
              </div>
              <p className="idea-concept">{idea.coreConcept}</p>
              <p>{idea.explanation}</p>
              <div className="idea-detail-grid">
                <div><strong>Audience need</strong><span>{idea.audienceSegment}: {idea.audienceNeed}</span></div>
                <div><strong>Why it fits</strong><span>{idea.rationale}</span></div>
                <div><strong>Visual direction</strong><span>{idea.visualDirection}</span></div>
                <div><strong>Destination relevance</strong><span>{idea.destinationRelevance}</span></div>
              </div>
              <div className="idea-keywords">
                {idea.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}
              </div>
              {idea.score && (
                <div className="idea-score-details">
                  <strong>Quality score · weighted out of 100</strong>
                  <div className="idea-score-dimensions">
                    {[
                      ["Trend", idea.score.trendRelevance],
                      ["Audience", idea.score.audienceResonance],
                      ["Search", idea.score.searchPotential],
                      ["Click", idea.score.clickPotential],
                      ["Visual", idea.score.visualAppeal],
                      ["Originality", idea.score.originality],
                      ["Evergreen", idea.score.evergreenValue],
                    ].map(([label, value]) => (
                      <span key={label}>{label} <strong>{value}/10</strong></span>
                    ))}
                  </div>
                  <p>{idea.score.reasoning}</p>
                  {idea.score.weaknesses.length > 0 && (
                    <p><strong>Watch-outs:</strong> {idea.score.weaknesses.join(" · ")}</p>
                  )}
                  {idea.score.improvementSuggestions.length > 0 && (
                    <p><strong>Improve:</strong> {idea.score.improvementSuggestions.join(" · ")}</p>
                  )}
                  {idea.selection?.reason && (
                    <p className="idea-selection-reason">{idea.selection.reason}</p>
                  )}
                </div>
              )}
              {idea.contentPackage?.generationStatus === "Complete" && (
                <div className="idea-content-package">
                  <strong>Generated pin content</strong>
                  <div>
                    <span>Title</span>
                    <p>{idea.contentPackage.pinterestTitle}</p>
                  </div>
                  <div>
                    <span>Description</span>
                    <p>{idea.contentPackage.description}</p>
                  </div>
                  <div className="idea-keywords">
                    {idea.contentPackage.hashtags.map((hashtag) => (
                      <span key={hashtag}>{hashtag}</span>
                    ))}
                  </div>
                  <div className="idea-keywords">
                    {idea.contentPackage.keywords.map((keyword) => (
                      <span key={keyword}>{keyword}</span>
                    ))}
                  </div>
                  <div>
                    <span>Image prompt</span>
                    <p>{idea.contentPackage.imagePrompt}</p>
                  </div>
                  <a
                    href={idea.contentPackage.destinationUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open destination page
                  </a>
                </div>
              )}
              <div className="idea-citations">
                <strong>Evidence</strong>
                {idea.sourceIds.map((sourceId) => {
                  const source = sourcesById.get(sourceId);
                  return source ? (
                    <a href={source.sourceUrl} key={sourceId} target="_blank" rel="noreferrer">
                      {source.title}
                    </a>
                  ) : null;
                })}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel idea-empty-panel">
          <Lightbulb size={20} />
          <strong>No ideas generated yet</strong>
          <span>Generate ideas from the completed report for {selectedTarget?.niche}.</span>
        </section>
      )}
    </div>
  );
}
