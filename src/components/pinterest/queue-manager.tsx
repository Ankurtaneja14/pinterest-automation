"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  ListOrdered,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Sliders,
  Trash2,
  XCircle,
} from "lucide-react";

interface Job {
  id: string;
  contentPackageId: string;
  accountId: string;
  boardId: string;
  scheduledAt: string;
  approvalStatus: string;
  status: string;
  retryCount: number;
  lastError: string | null;
  pinterestPinId?: string | null;
  pinterestPinUrl?: string | null;
  account: {
    id: string;
    username: string;
    displayName: string;
    profileImage: string | null;
    status: string;
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

export function QueueManager() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reschedule modal
  const [rescheduleJobId, setRescheduleJobId] = useState<string | null>(null);
  const [newScheduleTime, setNewScheduleTime] = useState("");

  const loadJobs = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (statusFilter !== "ALL" && statusFilter !== "ALL_WITH_HISTORY") {
        query.set("status", statusFilter);
      }
      const res = await fetch(`/api/pinterest/jobs?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load jobs.");
      setJobs(data.jobs || []);
      setStats(data.stats || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading queue.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  function toggleSelectAll() {
    if (selectedJobIds.size === queueJobs.length && queueJobs.length > 0) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(queueJobs.map((j) => j.id)));
    }
  }

  function toggleJob(id: string) {
    setSelectedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkAction(action: "approve" | "cancel") {
    if (selectedJobIds.size === 0) return;
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pinterest/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobIds: Array.from(selectedJobIds) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Bulk ${action} failed.`);
      setNotice(`Successfully ${action === "approve" ? "approved" : "cancelled"} ${data.count} jobs.`);
      setSelectedJobIds(new Set());
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Bulk ${action} failed.`);
    } finally {
      setActionLoading(false);
    }
  }

  async function cancelSingleJob(jobId: string) {
    try {
      const res = await fetch(`/api/pinterest/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) throw new Error("Could not cancel job.");
      setNotice("Job cancelled.");
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel job.");
    }
  }

  async function submitReschedule() {
    if (!rescheduleJobId || !newScheduleTime) return;
    try {
      const res = await fetch(`/api/pinterest/jobs/${rescheduleJobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reschedule", scheduledAt: new Date(newScheduleTime).toISOString() }),
      });
      if (!res.ok) throw new Error("Could not reschedule job.");
      setNotice("Job rescheduled successfully.");
      setRescheduleJobId(null);
      await loadJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reschedule job.");
    }
  }

  // Active queue statuses vs all
  const queueJobs = jobs.filter((j) => {
    if (statusFilter === "ALL") {
      return ["Draft", "AwaitingApproval", "Scheduled", "Pending", "Processing", "RetryPending"].includes(j.status);
    }
    if (statusFilter === "ALL_WITH_HISTORY") {
      return true;
    }
    return j.status === statusFilter;
  });

  return (
    <div className="queue-workspace">
      {/* Metrics Banner */}
      <section className="metrics-grid">
        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Scheduled</span>
            <Clock size={16} />
          </div>
          <div className="metric-value">{stats["Scheduled"] ?? 0}</div>
          <div className="metric-footnote">Waiting for scheduled time</div>
        </article>

        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Processing</span>
            <LoaderCircle size={16} className="spinning" />
          </div>
          <div className="metric-value">{stats["Processing"] ?? 0}</div>
          <div className="metric-footnote">Currently publishing</div>
        </article>

        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Awaiting Approval</span>
            <AlertCircle size={16} />
          </div>
          <div className="metric-value">{stats["AwaitingApproval"] ?? 0}</div>
          <div className="metric-footnote">Needs explicit user approval</div>
        </article>

        <article className="metric-card">
          <div className="metric-top">
            <span className="metric-label">Retry Pending</span>
            <RefreshCw size={16} />
          </div>
          <div className="metric-value">{stats["RetryPending"] ?? 0}</div>
          <div className="metric-footnote">Scheduled for automatic retry</div>
        </article>
      </section>

      {/* Control / Filter Bar */}
      <section className="panel queue-controls-panel">
        <div className="panel-heading">
          <div>
            <h2>Publishing Queue</h2>
            <p>Monitor, approve, reschedule, and manage upcoming publishing jobs.</p>
          </div>
          <div className="queue-quick-links">
            <Link className="secondary-button" href="/pinterest/engine">
              <Sliders size={14} />
              <span>Engine Controller</span>
            </Link>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadJobs()}
            >
              <RefreshCw size={14} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="queue-action-bar">
          <div className="filter-group">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">Active Queue Only</option>
              <option value="ALL_WITH_HISTORY">All Jobs (Including Published & Failed)</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Processing">Processing</option>
              <option value="AwaitingApproval">Awaiting Approval</option>
              <option value="RetryPending">Retry Pending</option>
              <option value="Published">Published</option>
              <option value="Failed">Failed</option>
              <option value="Draft">Draft</option>
            </select>
          </div>

          <div className="bulk-actions-group">
            <button
              className="secondary-button"
              type="button"
              disabled={selectedJobIds.size === 0 || actionLoading}
              onClick={() => void handleBulkAction("approve")}
            >
              <CheckCircle2 size={14} />
              <span>Approve Selected ({selectedJobIds.size})</span>
            </button>
            <button
              className="secondary-button image-remove-button"
              type="button"
              disabled={selectedJobIds.size === 0 || actionLoading}
              onClick={() => void handleBulkAction("cancel")}
            >
              <XCircle size={14} />
              <span>Cancel Selected</span>
            </button>
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
      {notice && (
        <div className="feedback-message feedback-success" role="status">
          <CheckCircle2 size={15} />
          <span>{notice}</span>
        </div>
      )}

      {/* Queue Table */}
      {loading ? (
        <section className="panel image-empty-panel">
          <LoaderCircle size={20} className="spinning" />
          <span>Loading publishing queue...</span>
        </section>
      ) : queueJobs.length === 0 ? (
        <section className="panel image-empty-panel">
          {stats["Published"] && stats["Published"] > 0 ? (
            <>
              <CheckCircle2 size={32} color="#2d7159" />
              <strong>All queued pins have been published!</strong>
              <span>
                {stats["Published"]} pins have been successfully published to Pinterest.
              </span>
              <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setStatusFilter("ALL_WITH_HISTORY")}
                >
                  Show Published Jobs Here
                </button>
                <Link className="primary-button" href="/pinterest/history">
                  View Publishing History
                </Link>
                <Link className="secondary-button" href="/pinterest/publish">
                  Schedule More Pins
                </Link>
              </div>
            </>
          ) : (
            <>
              <ListOrdered size={28} />
              <strong>The publishing queue is empty</strong>
              <span>Schedule pins from the Publishing Center to queue them for execution.</span>
              <Link className="primary-button" href="/pinterest/publish">
                Schedule Pins Now
              </Link>
            </>
          )}
        </section>
      ) : (
        <section className="panel queue-table-panel">
          <table className="queue-table">
            <thead>
              <tr>
                <th style={{ width: "36px" }}>
                  <input
                    type="checkbox"
                    checked={selectedJobIds.size === queueJobs.length && queueJobs.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>Pin Preview</th>
                <th>Target Account & Board</th>
                <th>Scheduled At</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {queueJobs.map((job) => {
                const isSelected = selectedJobIds.has(job.id);
                const assetId = job.contentPackage.assets[0]?.id;
                return (
                  <tr key={job.id} className={isSelected ? "selected-row" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleJob(job.id)}
                      />
                    </td>
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
                      <div className="queue-time-cell">
                        <span>{new Date(job.scheduledAt).toLocaleString()}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill status-${job.status.toLowerCase()}`}>
                        {job.status}
                      </span>
                      {job.lastError && (
                        <span className="job-error-hint" title={job.lastError}>
                          ⚠️ {job.lastError.slice(0, 35)}…
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="queue-actions-cell">
                        {job.pinterestPinUrl && (
                          <a
                            href={job.pinterestPinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="icon-button"
                            title="View Published Pin on Pinterest"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        {job.status !== "Published" && (
                          <>
                            <button
                              className="icon-button"
                              type="button"
                              title="Reschedule Job"
                              onClick={() => {
                                setRescheduleJobId(job.id);
                                setNewScheduleTime(new Date(job.scheduledAt).toISOString().slice(0, 16));
                              }}
                            >
                              <Calendar size={14} />
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              title="Cancel Job"
                              onClick={() => void cancelSingleJob(job.id)}
                            >
                              <XCircle size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Reschedule Modal */}
      {rescheduleJobId && (
        <div className="modal-backdrop" onClick={() => setRescheduleJobId(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reschedule Publishing Job</h3>
              <p>Choose a new execution time for this pin.</p>
            </div>
            <div className="modal-body">
              <label className="reschedule-input-label">
                <span>New Scheduled Date & Time:</span>
                <input
                  type="datetime-local"
                  value={newScheduleTime}
                  onChange={(e) => setNewScheduleTime(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRescheduleJobId(null)}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => void submitReschedule()}
              >
                Save Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

