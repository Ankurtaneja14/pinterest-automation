"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Zap,
} from "lucide-react";

interface EngineSettings {
  id: string;
  engineEnabled: boolean;
  engineStatus: string;
  timezone: string;
  workerConcurrency: number;
  retryLimit: number;
  retryBackoffMs: number;
  updatedAt: string;
}

export function EngineController() {
  const [settings, setSettings] = useState<EngineSettings | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [accountStats, setAccountStats] = useState<{ status: string; _count: { id: number } }[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [lastPollResult, setLastPollResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editable settings
  const [concurrency, setConcurrency] = useState(3);
  const [retryLimit, setRetryLimit] = useState(3);
  const [timezone, setTimezone] = useState("Asia/Kolkata");

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/pinterest/engine");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load engine status.");
      setSettings(data.settings);
      setStats(data.stats || {});
      setAccountStats(data.accountStats || []);

      if (data.settings) {
        setConcurrency(data.settings.workerConcurrency);
        setRetryLimit(data.settings.retryLimit);
        setTimezone(data.settings.timezone);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error connecting to engine.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Client-side execution loop when engine is Running
  useEffect(() => {
    if (settings?.engineEnabled && settings.engineStatus === "Running") {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/pinterest/engine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "poll" }),
          });
          const data = await res.json();
          if (data.processed > 0) {
            setLastPollResult(
              `Processed ${data.processed} job(s): ${data.succeeded} succeeded, ${data.failed} failed at ${new Date().toLocaleTimeString()}`,
            );
            void loadStatus();
          }
        } catch {
          // background poll failed, ignore silently
        }
      }, 8000); // Poll every 8 seconds
    } else {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    }

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [settings?.engineEnabled, settings?.engineStatus, loadStatus]);

  async function handleEngineAction(action: "start" | "pause" | "resume" | "stop" | "recover" | "poll") {
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pinterest/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Engine action '${action}' failed.`);

      if (action === "recover") {
        setNotice(`Recovered ${data.recovered ?? 0} stale leased jobs back to queue.`);
      } else if (action === "poll") {
        setNotice(`Manual poll executed: ${data.processed ?? 0} jobs processed (${data.succeeded ?? 0} succeeded, ${data.failed ?? 0} failed).`);
      } else {
        setNotice(`Engine status changed to: ${data.status}`);
      }

      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Engine action failed.`);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pinterest/engine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "updateSettings",
          workerConcurrency: concurrency,
          retryLimit: retryLimit,
          timezone: timezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not update settings.");
      setNotice("Engine configuration saved successfully.");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings.");
    } finally {
      setActionLoading(false);
    }
  }

  const isRunning = settings?.engineStatus === "Running";
  const isPaused = settings?.engineStatus === "Paused";

  if (loading) {
    return (
      <section className="panel image-empty-panel">
        <LoaderCircle size={20} className="spinning" />
        <span>Connecting to publishing engine...</span>
      </section>
    );
  }

  return (
    <div className="engine-dashboard">
      {/* Engine Status Banner */}
      <section className="panel engine-status-panel">
        <div className="engine-status-header">
          <div className="status-display-left">
            <div className={`status-indicator-disc ${isRunning ? "running" : isPaused ? "paused" : "stopped"}`}>
              {isRunning && <span className="status-pulse-ring" />}
              <Cpu size={22} />
            </div>
            <div>
              <span className="eyebrow">PUBLISHING BACKGROUND WORKER</span>
              <h2>Engine Status: {settings?.engineStatus ?? "Stopped"}</h2>
              <p>
                {isRunning
                  ? "Active and polling SQLite queue for scheduled pins."
                  : isPaused
                    ? "Paused. Current in-progress jobs will finish, no new jobs claimed."
                    : "Stopped. All publishing background operations are inactive."}
              </p>
            </div>
          </div>

          <div className="engine-control-buttons">
            {!isRunning ? (
              <button
                className="primary-button engine-start-btn"
                type="button"
                disabled={actionLoading}
                onClick={() => void handleEngineAction(isPaused ? "resume" : "start")}
              >
                <Play size={16} />
                <span>{isPaused ? "Resume Engine" : "Start Engine"}</span>
              </button>
            ) : (
              <button
                className="secondary-button"
                type="button"
                disabled={actionLoading}
                onClick={() => void handleEngineAction("pause")}
              >
                <Pause size={16} />
                <span>Pause Engine</span>
              </button>
            )}

            <button
              className="secondary-button image-remove-button"
              type="button"
              disabled={actionLoading || settings?.engineStatus === "Stopped"}
              onClick={() => void handleEngineAction("stop")}
            >
              <Square size={16} />
              <span>Stop Engine</span>
            </button>

            <button
              className="secondary-button"
              type="button"
              disabled={actionLoading}
              onClick={() => void handleEngineAction("poll")}
              title="Run a single poll pass immediately"
            >
              <Zap size={14} />
              <span>Run Poll Now</span>
            </button>

            <button
              className="secondary-button"
              type="button"
              disabled={actionLoading}
              onClick={() => void handleEngineAction("recover")}
              title="Release stranded leases from previous server restarts"
            >
              <RotateCcw size={14} />
              <span>Recover Leases</span>
            </button>
          </div>
        </div>

        {lastPollResult && (
          <div className="last-poll-banner">
            <Activity size={14} />
            <span>{lastPollResult}</span>
          </div>
        )}
      </section>

      {/* Notices */}
      {error && (
        <div className="workspace-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="feedback-message feedback-success" role="status">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}

      {/* Grid: Live Queue & Account Health */}
      <div className="engine-overview-grid">
        <section className="panel queue-stat-panel">
          <div className="panel-heading">
            <div>
              <h3>Job Queue Status</h3>
              <p>Breakdown of all database-backed publishing jobs</p>
            </div>
          </div>
          <div className="queue-counts-grid">
            <div className="count-tile">
              <span>Scheduled</span>
              <strong>{stats["Scheduled"] ?? 0}</strong>
            </div>
            <div className="count-tile highlight">
              <span>Processing</span>
              <strong>{stats["Processing"] ?? 0}</strong>
            </div>
            <div className="count-tile">
              <span>Awaiting Approval</span>
              <strong>{stats["AwaitingApproval"] ?? 0}</strong>
            </div>
            <div className="count-tile">
              <span>Retry Pending</span>
              <strong>{stats["RetryPending"] ?? 0}</strong>
            </div>
            <div className="count-tile success">
              <span>Published</span>
              <strong>{stats["Published"] ?? 0}</strong>
            </div>
            <div className="count-tile danger">
              <span>Failed</span>
              <strong>{stats["Failed"] ?? 0}</strong>
            </div>
          </div>
        </section>

        {/* Engine Settings Panel */}
        <section className="panel settings-form-panel">
          <div className="panel-heading">
            <div>
              <h3>Engine Concurrency & Limits</h3>
              <p>Control rate limits, batch size, and failure retries</p>
            </div>
          </div>

          <form onSubmit={(e) => void handleSaveSettings(e)} className="engine-settings-form">
            <label className="settings-field">
              <span>Worker Concurrency (Max concurrent pins):</span>
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
              />
              <small>Limits simultaneous API requests to respect Pinterest platform limits.</small>
            </label>

            <label className="settings-field">
              <span>Retry Limit (Attempts before failure):</span>
              <input
                type="number"
                min={1}
                max={5}
                value={retryLimit}
                onChange={(e) => setRetryLimit(Number(e.target.value))}
              />
              <small>Transient errors are retried with exponential backoff.</small>
            </label>

            <label className="settings-field">
              <span>Default Timezone:</span>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </label>

            <div className="settings-submit-row">
              <button
                className="primary-button"
                type="submit"
                disabled={actionLoading}
              >
                <Save size={14} />
                <span>Save Engine Settings</span>
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}

