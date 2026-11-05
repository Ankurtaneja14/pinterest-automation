"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  History,
  Layers,
  LoaderCircle,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";

interface Job {
  id: string;
  contentPackageId: string;
  accountId: string;
  boardId: string;
  scheduledAt: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  pinterestPinId: string | null;
  pinterestPinUrl: string | null;
  finishedAt: string | null;
  account: {
    id: string;
    username: string;
    displayName: string;
    profileImage: string | null;
  };
  board: {
    id: string;
    name: string;
    pinterestBoardId: string;
  };
  contentPackage: {
    id: string;
    pinterestTitle: string;
    description: string;
    destinationUrl: string;
    assets: { id: string }[];
  };
}

export function HistoryMonitor() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/pinterest/jobs?pageSize=100");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load history.");
      setJobs(data.jobs || []);
      setStats(data.stats || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const historyJobs = jobs.filter((j) => {
    const isTerminal = ["Published", "Failed", "Cancelled"].includes(j.status);
    if (!isTerminal) return false;
    if (statusFilter !== "ALL" && j.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchTitle = j.contentPackage.pinterestTitle.toLowerCase().includes(q);
      const matchAccount = j.account.username.toLowerCase().includes(q);
      return matchTitle || matchAccount;
    }
    return true;
  });

  return (
    <div className="history-workspace">
      {/* Metric cards */}
      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Published Pins</span>
            <CheckCircle2 size={16} />
          </div>
          <div className="metric-value">{stats["Published"] ?? 0}</div>
          <div className="metric-footnote">Successfully live on Pinterest</div>
        </article>

        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Failed Jobs</span>
            <AlertCircle size={16} />
          </div>
          <div className="metric-value">{stats["Failed"] ?? 0}</div>
          <div className="metric-footnote">Permanent or exhausted failures</div>
        </article>

        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Cancelled Jobs</span>
            <XCircle size={16} />
          </div>
          <div className="metric-value">{stats["Cancelled"] ?? 0}</div>
          <div className="metric-footnote">Cancelled by user or disconnected</div>
        </article>
      </section>

      {/* Filter panel */}
      <section className="panel queue-controls-panel">
        <div className="panel-heading">
          <div>
            <h2>Publishing History & Logs</h2>
            <p>Permanent historical audit of all completed, failed, and cancelled publishing operations.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadHistory()}
          >
            <RefreshCw size={14} />
            <span>Refresh History</span>
          </button>
        </div>

        <div className="queue-action-bar">
          <div className="search-input-box" style={{ width: "320px" }}>
            <Search size={15} />
            <input
              type="text"
              placeholder="Search pin title, @account..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="filter-group">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Completed Operations</option>
              <option value="Published">Published Only</option>
              <option value="Failed">Failed Only</option>
              <option value="Cancelled">Cancelled Only</option>
            </select>
          </div>
        </div>
      </section>

      {/* Notices */}
      {error && (
        <div className="workspace-error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* History Table */}
      {loading ? (
        <section className="panel image-empty-panel">
          <LoaderCircle size={20} className="spinning" />
          <span>Loading publishing history...</span>
        </section>
      ) : historyJobs.length === 0 ? (
        <section className="panel image-empty-panel">
          <History size={24} />
          <strong>No historical publishing records found</strong>
          <span>Once scheduled jobs are processed by the engine, their results will appear here.</span>
        </section>
      ) : (
        <section className="panel queue-table-panel">
          <table className="queue-table">
            <thead>
              <tr>
                <th>Pin Content</th>
                <th>Target Account & Board</th>
                <th>Status</th>
                <th>Outcome / Link</th>
                <th>Finished At</th>
              </tr>
            </thead>
            <tbody>
              {historyJobs.map((job) => {
                const assetId = job.contentPackage.assets[0]?.id;
                return (
                  <tr key={job.id}>
                    <td>
                      <div className="queue-pin-cell">
                        {assetId && (
                          <div className="queue-pin-thumb">
                            <Image
                              src={`/api/images/assets/${encodeURIComponent(assetId)}`}
                              alt={job.contentPackage.pinterestTitle}
                              width={48}
                              height={64}
                              className="queue-thumb-img"
                              unoptimized
                            />
                          </div>
                        )}
                        <div className="queue-pin-info">
                          <strong>{job.contentPackage.pinterestTitle}</strong>
                          <span className="queue-dest-url">{job.contentPackage.destinationUrl}</span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="queue-account-cell">
                        <strong>@{job.account.username}</strong>
                        <span className="queue-board-name">Board: {job.board.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill status-${job.status.toLowerCase()}`}>
                        {job.status}
                      </span>
                    </td>
                    <td>
                      {job.pinterestPinUrl ? (
                        <a
                          href={job.pinterestPinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="pin-live-link"
                        >
                          <span>View on Pinterest</span>
                          <ExternalLink size={12} />
                        </a>
                      ) : job.lastError ? (
                        <span className="job-error-msg" title={job.lastError}>
                          {job.lastError}
                        </span>
                      ) : (
                        <span className="job-neutral-text">—</span>
                      )}
                    </td>
                    <td>
                      <span className="history-timestamp">
                        {job.finishedAt
                          ? new Date(job.finishedAt).toLocaleString()
                          : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

