"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, BookOpenText, LoaderCircle, Search, Sparkles } from "lucide-react";
import { z } from "zod";

const scheduleSchema = z.object({
  id: z.string(),
  niche: z.string(),
  targetCountry: z.string(),
  targetAudience: z.string(),
  language: z.string(),
  executionDate: z.string(),
});

const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceUrl: z.string().url(),
  canonicalUrl: z.string().url(),
  publishedAt: z.string().nullable(),
  retrievedAt: z.string(),
  excerpt: z.string(),
  relevance: z.string().nullable(),
});

const citedTextSchema = z.object({
  text: z.string(),
  sourceIds: z.array(z.string()),
});

const reportSchema = z.object({
  overview: citedTextSchema,
  keyFindings: z.array(citedTextSchema),
  audienceInsights: z.array(citedTextSchema),
  searchOpportunities: z.array(
    z.object({
      query: z.string(),
      intent: z.string(),
      rationale: z.string(),
      sourceIds: z.array(z.string()),
    }),
  ),
  contentAngles: z.array(
    z.object({
      angle: z.string(),
      format: z.string(),
      rationale: z.string(),
      sourceIds: z.array(z.string()),
    }),
  ),
  searchQueries: z.array(z.string()),
  warnings: z.array(z.string()),
  provider: z.string(),
  model: z.string(),
  generatedAt: z.string(),
});

const sessionSchema = z.object({
  id: z.string(),
  status: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  report: reportSchema.nullable(),
  sources: z.array(sourceSchema),
});

const historySchema = z.object({
  schedule: z.object({
    id: z.string(),
    niche: z.string(),
    targetCountry: z.string(),
    targetAudience: z.string(),
    language: z.string(),
    executionDate: z.string(),
  }),
  sessions: z.array(sessionSchema),
});

const apiErrorSchema = z.object({ error: z.string() });

type Schedule = z.infer<typeof scheduleSchema>;
type ResearchSession = z.infer<typeof sessionSchema>;
type ResearchReport = z.infer<typeof reportSchema>;

function getErrorMessage(payload: unknown, fallback: string): string {
  const parsed = apiErrorSchema.safeParse(payload);
  return parsed.success ? parsed.data.error : fallback;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function CitationList({
  sourceIds,
  sources,
}: {
  sourceIds: string[];
  sources: ResearchSession["sources"];
}) {
  const sourceNumbers = new Map(
    sources.map((source, index) => [source.id, index + 1]),
  );
  return (
    <span className="research-citations" aria-label="Cited sources">
      {sourceIds.map((sourceId) => (
        <a
          href={`#source-${sourceId}`}
          key={sourceId}
          aria-label={`Source ${sourceNumbers.get(sourceId) ?? "unknown"}`}
        >
          [{sourceNumbers.get(sourceId) ?? "?"}]
        </a>
      ))}
    </span>
  );
}

function ResearchReportView({
  report,
  session,
}: {
  report: ResearchReport;
  session: ResearchSession;
}) {
  const sourceNumber = new Map(
    session.sources.map((source, index) => [source.id, index + 1]),
  );
  return (
    <>
      <section className="panel research-report-card">
        <div className="panel-heading">
          <div>
            <h2>Research brief</h2>
            <p>
              Generated {formatDate(report.generatedAt)} · {report.provider} ·{" "}
              {report.model}
            </p>
          </div>
          <span className="metric-icon">
            <Sparkles size={17} />
          </span>
        </div>
        {report.warnings.map((warning) => (
          <p className="feedback-message feedback-warning" key={warning}>
            {warning}
          </p>
        ))}
        <p className="research-overview">
          {report.overview.text}
          <CitationList sourceIds={report.overview.sourceIds} sources={session.sources} />
        </p>
        <div className="research-report-grid">
          <section>
            <h3>Key findings</h3>
            <ul>
              {report.keyFindings.map((item, index) => (
                <li key={`${item.text}-${index}`}>
                  {item.text}
                  <CitationList sourceIds={item.sourceIds} sources={session.sources} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Audience insights</h3>
            <ul>
              {report.audienceInsights.map((item, index) => (
                <li key={`${item.text}-${index}`}>
                  {item.text}
                  <CitationList sourceIds={item.sourceIds} sources={session.sources} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Search opportunities</h3>
            <ul>
              {report.searchOpportunities.map((item, index) => (
                <li key={`${item.query}-${index}`}>
                  <strong>{item.query}</strong>
                  <span className="research-item-meta">
                    {item.intent} · {item.rationale}
                  </span>
                  <CitationList sourceIds={item.sourceIds} sources={session.sources} />
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Content angles</h3>
            <ul>
              {report.contentAngles.map((item, index) => (
                <li key={`${item.angle}-${index}`}>
                  <strong>{item.angle}</strong>
                  <span className="research-item-meta">
                    {item.format} · {item.rationale}
                  </span>
                  <CitationList sourceIds={item.sourceIds} sources={session.sources} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </section>

      <section className="panel research-sources-card">
        <div className="panel-heading">
          <div>
            <h2>Retrieved sources ({session.sources.length})</h2>
            <p>Search-result excerpts are evidence leads; open original pages to verify details.</p>
          </div>
          <BookOpenText size={17} className="research-source-icon" />
        </div>
        <div className="research-source-list">
          {session.sources.map((source) => (
            <article id={`source-${source.id}`} className="research-source" key={source.id}>
              <span className="research-source-number">
                [{sourceNumber.get(source.id)}]
              </span>
              <div>
                <a href={source.sourceUrl} target="_blank" rel="noreferrer">
                  {source.title}
                </a>
                <span className="research-source-url">{source.canonicalUrl}</span>
                <p>{source.excerpt}</p>
                <span className="research-item-meta">
                  Retrieved {formatDate(source.retrievedAt)}
                  {source.publishedAt ? ` · Published ${formatDate(source.publishedAt)}` : ""}
                  {source.relevance ? ` · Query: ${source.relevance}` : ""}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

export function ResearchWorkspace({ schedules: scheduleInput }: { schedules: Schedule[] }) {
  const schedules = useMemo(
    () => scheduleInput.map((schedule) => scheduleSchema.parse(schedule)),
    [scheduleInput],
  );
  const [scheduleId, setScheduleId] = useState(schedules[0]?.id ?? "");
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [loading, setLoading] = useState(schedules.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async (): Promise<ResearchSession[]> => {
    if (!scheduleId) {
      return [];
    }
    const response = await fetch(
      `/api/research?scheduleId=${encodeURIComponent(scheduleId)}`,
      { cache: "no-store" },
    );
    const payload: unknown = await response.json();
    if (!response.ok) {
      throw new Error(getErrorMessage(payload, "Could not load research history."));
    }
    const history = historySchema.safeParse(payload);
    if (!history.success) {
      throw new Error("The server returned invalid research history.");
    }
    return history.data.sessions;
  }, [scheduleId]);

  useEffect(() => {
    let cancelled = false;
    void loadHistory()
      .then((history) => {
        if (!cancelled) {
          setSessions(history);
          setError(null);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load research history.",
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
  }, [loadHistory]);

  const activeSession = sessions.find(
    (session) => session.status === "Pending" || session.status === "Running",
  );

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    const interval = setInterval(() => {
      void loadHistory()
        .then((history) => {
          setSessions(history);
          setError(null);
        })
        .catch((loadError: unknown) => {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load research history.",
          );
        });
    }, 2_000);
    return () => clearInterval(interval);
  }, [activeSession, loadHistory]);

  async function startResearch() {
    if (!scheduleId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scheduleId }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(getErrorMessage(payload, "Could not start research."));
      }
      setSessions(await loadHistory());
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : "Could not start research.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="research-workspace">
      <section className="panel research-control-panel">
        <div className="panel-heading">
          <div>
            <h2>Start evidence collection</h2>
            <p>
              Four targeted public searches retrieve recent source snippets;
              configured AI turns them into a cited research brief.
            </p>
          </div>
          <span className="metric-icon"><Search size={17} /></span>
        </div>
        {schedules.length === 0 ? (
          <div className="schedule-empty">
            <Search size={20} className="schedule-empty-icon" />
            <strong>Import a schedule to begin research</strong>
            <span>Research uses the niche, audience, country, and language from a saved schedule.</span>
            <a className="secondary-button research-schedule-link" href="/schedules">
              Open schedules
            </a>
          </div>
        ) : (
          <div className="research-controls">
            <label>
              Schedule
              <select
                className="research-select"
                value={scheduleId}
                onChange={(event) => {
                  setLoading(true);
                  setScheduleId(event.currentTarget.value);
                  setSessions([]);
                  setError(null);
                }}
              >
                {schedules.map((schedule) => (
                  <option value={schedule.id} key={schedule.id}>
                    {schedule.niche} · {schedule.targetCountry} · {schedule.targetAudience} · {schedule.executionDate}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!scheduleId || busy || Boolean(activeSession)}
              onClick={() => void startResearch()}
            >
              {busy || activeSession ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <Search size={15} />
              )}
              {activeSession ? "Research running…" : "Run research"}
            </button>
            <span className="field-note">
              Research runs in the background. Search result snippets are stored
              locally with every report citation.
            </span>
          </div>
        )}
        {error && (
          <p className="feedback-message feedback-error" role="alert">
            <AlertCircle size={14} /> {error}
          </p>
        )}
      </section>

      {loading && sessions.length === 0 ? (
        <div className="settings-loading">
          <LoaderCircle size={17} className="spinning" />
          Loading research history…
        </div>
      ) : sessions.length === 0 ? (
        schedules.length > 0 && (
          <section className="panel research-empty-panel">
            <BookOpenText size={20} />
            <strong>No research report yet</strong>
            <span>Start research to save cited findings and source excerpts here.</span>
          </section>
        )
      ) : (
        <>
          {sessions.map((session) =>
            session.report ? (
              <ResearchReportView
                key={session.id}
                report={session.report}
                session={session}
              />
            ) : (
              <section className="panel research-progress-panel" key={session.id}>
                {session.status === "Failed" ? (
                  <AlertCircle size={17} />
                ) : (
                  <LoaderCircle size={17} className="spinning" />
                )}
                <div>
                  <strong>Research {session.status.toLowerCase()}</strong>
                  <span>
                    {session.status === "Failed"
                      ? "The failure was recorded. Correct the issue and run research again."
                      : "Collecting public sources and preparing an evidence-linked brief."}
                  </span>
                </div>
                <span className="research-history-date">{formatDate(session.createdAt)}</span>
              </section>
            ),
          )}
        </>
      )}
    </div>
  );
}
