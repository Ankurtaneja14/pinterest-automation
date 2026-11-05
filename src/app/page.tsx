import {
  Clock3,
  Images,
  Layers3,
  Sparkles,
} from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [scheduleCount, executionCount, packageCount, assetCount, executions] =
    await Promise.all([
      prisma.nicheSchedule.count(),
      prisma.executionJob.count(),
      prisma.contentPackage.count(),
      prisma.generatedAsset.count(),
      prisma.executionJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { schedule: true },
      }),
    ]);

  const metrics = [
    { label: "Niche schedules", value: scheduleCount, icon: Layers3 },
    { label: "Executions", value: executionCount, icon: Clock3 },
    { label: "Content packages", value: packageCount, icon: Sparkles },
    { label: "Generated images", value: assetCount, icon: Images },
  ];

  return (
    <DashboardShell activeSection="overview">
      <div className="page-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">YOUR CONTENT WORKSPACE</div>
            <h1>Overview</h1>
            <p className="page-description">
              Your research-to-Pinterest workflow starts here.
            </p>
          </div>
          <div className="date-chip">
            <Clock3 size={15} />
            <span>Timezone: Asia/Kolkata</span>
          </div>
        </div>

        <section className="metrics-grid" aria-label="Workspace totals">
          {metrics.map(({ label, value, icon: Icon }) => (
            <article className="metric-card" key={label}>
              <div className="metric-top">
                <span className="metric-label">{label}</span>
                <span className="metric-icon">
                  <Icon size={17} strokeWidth={1.8} />
                </span>
              </div>
              <div className="metric-value">{value.toLocaleString()}</div>
              <div className="metric-footnote">From your local database</div>
            </article>
          ))}
        </section>

        <section className="overview-grid">
          <article className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <h2>Execution activity</h2>
                <p>Progress and outcomes from your content runs.</p>
              </div>
              <span className="activity-scope">Latest first</span>
            </div>
            {executions.length === 0 ? (
              <div className="empty-state">
                <div className="empty-illustration">
                  <div className="empty-sparkle">
                    <Sparkles size={20} />
                  </div>
                  <div className="empty-lines">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <h3>No executions yet</h3>
                <p>
                  Once a schedule is imported and run, its stages and outcomes
                  will appear here.
                </p>
              </div>
            ) : (
              <div className="execution-list">
                {executions.map((execution) => (
                  <div className="execution-row" key={execution.id}>
                    <span className="execution-mark">
                      <Layers3 size={15} />
                    </span>
                    <div className="execution-copy">
                      <strong>{execution.schedule.niche}</strong>
                      <span>
                        {execution.schedule.targetCountry} ·{" "}
                        {new Intl.DateTimeFormat("en-IN", {
                          dateStyle: "medium",
                          timeZone: "Asia/Kolkata",
                        }).format(execution.createdAt)}
                      </span>
                    </div>
                    <span className="execution-status">{execution.status}</span>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="panel setup-panel">
            <div className="panel-heading">
              <div>
                <h2>Getting started</h2>
                <p>Build your production workflow step by step.</p>
              </div>
            </div>
            <div className="setup-list">
              <div className="setup-step setup-step-complete">
                <span className="step-number">1</span>
                <div>
                  <strong>Project foundation</strong>
                  <span>Application shell and persistent data layer</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step setup-step-complete">
                <span className="step-number">2</span>
                <div>
                  <strong>Connect your schedule</strong>
                  <span>Excel import and schedule validation</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step setup-step-complete">
                <span className="step-number">3</span>
                <div>
                  <strong>Configure your AI provider</strong>
                  <span>Secure credentials and model settings</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step setup-step-complete">
                <span className="step-number">4</span>
                <div>
                  <strong>Build the research brief</strong>
                  <span>Gather current evidence and cited insights</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step setup-step-complete">
                <span className="step-number">5</span>
                <div>
                  <strong>Generate content ideas</strong>
                  <span>Create distinct, evidence-cited Pinterest concepts</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step setup-step-complete">
                <span className="step-number">6</span>
                <div>
                  <strong>Score and select pin ideas</strong>
                  <span>Rank ideas and choose a diverse pin-ready subset</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step setup-step-complete">
                <span className="step-number">7</span>
                <div>
                  <strong>Generate content packages</strong>
                  <span>Create pin titles, descriptions, and image prompts</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step setup-step-complete">
                <span className="step-number">8</span>
                <div>
                  <strong>Create and upload pin images</strong>
                  <span>Generate with Playwright Gemini and validate images in your library</span>
                </div>
                <span className="step-check">✓</span>
              </div>
              <div className="setup-step">
                <span className="step-number">9</span>
                <div>
                  <strong>Automate the worker</strong>
                  <span>Run durable jobs with checkpoint and restart recovery</span>
                </div>
                <span className="step-label">NEXT</span>
              </div>
            </div>
            <div className="setup-note">
              <span className="note-icon">
                <Sparkles size={14} />
              </span>
              <span>
                Each milestone is validated before the next capability is
                introduced.
              </span>
            </div>
          </article>
        </section>

        <footer className="page-footer">
          <span>PINPOINT CONTENT ENGINE</span>
          <span>Dashboard metrics are read directly from SQLite.</span>
        </footer>
      </div>
    </DashboardShell>
  );
}
