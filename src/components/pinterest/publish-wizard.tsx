"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Images,
  Layers,
  LoaderCircle,
  Send,
  Users,
} from "lucide-react";

interface ContentItem {
  id: string;
  contentId: string;
  pinterestTitle: string;
  description: string;
  destinationUrl: string;
  niche: string;
  targetCountry: string;
  asset: {
    id: string;
    imageUrl: string;
    width: number | null;
    height: number | null;
  } | null;
}

interface Board {
  id: string;
  pinterestBoardId: string;
  name: string;
  isDefault: boolean;
}

interface Account {
  id: string;
  username: string;
  displayName: string;
  profileImage: string | null;
  status: string;
  boards: Board[];
}

export function PublishWizard() {
  const [contentList, setContentList] = useState<ContentItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Selections
  const [selectedContentIds, setSelectedContentIds] = useState<Set<string>>(new Set());
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [accountBoardMap, setAccountBoardMap] = useState<Record<string, string>>({}); // accountId -> boardId

  // Scheduling options
  const [scheduleType, setScheduleType] = useState<"immediate" | "scheduled">("immediate");
  const [scheduleDateTime, setScheduleDateTime] = useState<string>(() => {
    // Default to +1 hour from now formatted for datetime-local
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [timezone] = useState("Asia/Kolkata");
  const [approvedByUser, setApprovedByUser] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const [contentRes, accountsRes] = await Promise.all([
          fetch("/api/pinterest/content-library"),
          fetch("/api/pinterest/accounts"),
        ]);
        const contentData = await contentRes.json();
        const accountsData = await accountsRes.json();

        if (!contentRes.ok) throw new Error(contentData.error || "Failed to load content.");
        if (!accountsRes.ok) throw new Error(accountsData.error || "Failed to load accounts.");

        setContentList(contentData.items || []);

        const rawAccounts: Account[] = [];
        const boardMapping: Record<string, string> = {};

        // Fetch boards for each connected account
        for (const acc of accountsData.accounts || []) {
          if (acc.status === "Connected") {
            try {
              const boardsRes = await fetch(`/api/pinterest/accounts/${acc.id}/boards`);
              const boardsData = await boardsRes.json();
              const bList: Board[] = boardsData.boards || [];
              rawAccounts.push({ ...acc, boards: bList });

              // Auto-select default board or first available board
              const def = bList.find((b) => b.isDefault) ?? bList[0];
              if (def) boardMapping[acc.id] = def.id;
            } catch {
              rawAccounts.push({ ...acc, boards: [] });
            }
          }
        }

        setAccounts(rawAccounts);
        setAccountBoardMap(boardMapping);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error loading publishing data.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  function toggleContentSelection(id: string) {
    setSelectedContentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllContent() {
    if (selectedContentIds.size === contentList.length) {
      setSelectedContentIds(new Set());
    } else {
      setSelectedContentIds(new Set(contentList.map((c) => c.id)));
    }
  }

  function toggleAccountSelection(id: string) {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllAccounts() {
    if (selectedAccountIds.size === accounts.length) {
      setSelectedAccountIds(new Set());
    } else {
      setSelectedAccountIds(new Set(accounts.map((a) => a.id)));
    }
  }

  const totalJobsCount = selectedContentIds.size * selectedAccountIds.size;

  async function handleSchedulePublishing() {
    if (selectedContentIds.size === 0) {
      setError("Please select at least one content item.");
      return;
    }
    if (selectedAccountIds.size === 0) {
      setError("Please select at least one Pinterest account.");
      return;
    }
    if (!approvedByUser) {
      setError("Please review and confirm explicit approval for these publishing jobs.");
      return;
    }

    // Ensure every selected account has a board chosen
    const pairs: { accountId: string; boardId: string }[] = [];
    for (const accId of selectedAccountIds) {
      const bId = accountBoardMap[accId];
      if (!bId) {
        const acc = accounts.find((a) => a.id === accId);
        setError(`Please assign a Pinterest board for @${acc?.username ?? accId}.`);
        return;
      }
      pairs.push({ accountId: accId, boardId: bId });
    }

    const scheduledDate =
      scheduleType === "immediate"
        ? new Date(Date.now() - 1000) // available immediately
        : new Date(scheduleDateTime);

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/pinterest/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentPackageIds: Array.from(selectedContentIds),
          accountBoardPairs: pairs,
          scheduledAt: scheduledDate.toISOString(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not schedule jobs.");

      // Now automatically approve them since the user checked explicit approval
      if (data.jobsCreated > 0) {
        // Fetch newly created draft jobs and approve them
        const listRes = await fetch("/api/pinterest/jobs?approvalStatus=AwaitingApproval");
        const listData = await listRes.json();
        const pendingJobIds = (listData.jobs || []).map((j: { id: string }) => j.id);
        if (pendingJobIds.length > 0) {
          await fetch("/api/pinterest/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve", jobIds: pendingJobIds }),
          });
        }
      }

      setSuccess(`Successfully created and scheduled ${data.jobsCreated} publishing job${data.jobsCreated === 1 ? "" : "s"}!`);
      setSelectedContentIds(new Set());
      setSelectedAccountIds(new Set());
      setApprovedByUser(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error creating publishing jobs.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="panel image-empty-panel">
        <LoaderCircle size={20} className="spinning" />
        <span>Loading Content Library and connected accounts...</span>
      </section>
    );
  }

  return (
    <div className="publish-wizard">
      {/* Step 1: Content Library Selection */}
      <section className="panel wizard-step-panel">
        <div className="panel-heading">
          <div>
            <span className="step-tag">STEP 1</span>
            <h2>Select Content from Library</h2>
            <p>
              Choose generated Pinterest content ready for distribution. Original images, titles, descriptions, and destination URLs will be preserved.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={selectAllContent}
            disabled={contentList.length === 0}
          >
            {selectedContentIds.size === contentList.length && contentList.length > 0
              ? "Deselect All"
              : "Select All Content"}
          </button>
        </div>

        {contentList.length === 0 ? (
          <div className="empty-content-state">
            <Images size={24} />
            <strong>No ready-to-publish content found</strong>
            <span>
              Generate complete content packages with validated images in the Content Library first.
            </span>
            <Link className="primary-button" href="/images">
              Go to Content Library
            </Link>
          </div>
        ) : (
          <div className="content-selection-grid">
            {contentList.map((item) => {
              const isSelected = selectedContentIds.has(item.id);
              return (
                <div
                  className={`content-select-card ${isSelected ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => toggleContentSelection(item.id)}
                >
                  <div className="content-checkbox-wrapper">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleContentSelection(item.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  {item.asset?.imageUrl && (
                    <div className="content-thumbnail-frame">
                      <Image
                        src={item.asset.imageUrl}
                        alt={item.pinterestTitle}
                        width={140}
                        height={190}
                        className="content-thumb-img"
                        unoptimized
                      />
                    </div>
                  )}
                  <div className="content-card-details">
                    <span className="content-niche-pill">{item.niche}</span>
                    <strong className="content-title-text">{item.pinterestTitle}</strong>
                    <p className="content-desc-snippet">{item.description}</p>
                    <span className="content-dest-link">🔗 {item.destinationUrl}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Step 2: Target Accounts & Boards */}
      <section className="panel wizard-step-panel">
        <div className="panel-heading">
          <div>
            <span className="step-tag">STEP 2</span>
            <h2>Select Target Accounts & Boards</h2>
            <p>
              Choose which Pinterest accounts will publish this content and select the destination board for each account.
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={selectAllAccounts}
            disabled={accounts.length === 0}
          >
            {selectedAccountIds.size === accounts.length && accounts.length > 0
              ? "Deselect All"
              : "Select All Accounts"}
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="empty-content-state">
            <Users size={24} />
            <strong>No active connected accounts</strong>
            <span>Connect at least one Pinterest account to schedule pins.</span>
            <Link className="primary-button" href="/pinterest/accounts">
              Connect Pinterest Account
            </Link>
          </div>
        ) : (
          <div className="accounts-selection-list">
            {accounts.map((acc) => {
              const isSelected = selectedAccountIds.has(acc.id);
              const selectedBoardId = accountBoardMap[acc.id] ?? "";
              return (
                <div
                  className={`account-select-row ${isSelected ? "selected" : ""}`}
                  key={acc.id}
                >
                  <div className="account-row-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAccountSelection(acc.id)}
                    />
                  </div>
                  <div className="account-row-info">
                    <strong>{acc.displayName}</strong>
                    <span className="account-row-handle">@{acc.username}</span>
                  </div>

                  <div className="account-board-picker">
                    <label>
                      <Layers size={13} />
                      <span>Destination Board:</span>
                      <select
                        value={selectedBoardId}
                        disabled={!isSelected || acc.boards.length === 0}
                        onChange={(e) =>
                          setAccountBoardMap((prev) => ({
                            ...prev,
                            [acc.id]: e.target.value,
                          }))
                        }
                      >
                        {acc.boards.length === 0 ? (
                          <option value="">No boards found</option>
                        ) : (
                          acc.boards.map((b) => (
                            <option value={b.id} key={b.id}>
                              {b.name} {b.isDefault ? "(Default)" : ""}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Step 3: Schedule & Confirmation */}
      <section className="panel wizard-step-panel">
        <div className="panel-heading">
          <div>
            <span className="step-tag">STEP 3</span>
            <h2>Publishing Schedule & Approval</h2>
            <p>Configure execution timing and provide explicit user approval.</p>
          </div>
        </div>

        <div className="schedule-controls-grid">
          <div className="schedule-type-selector">
            <label className={`radio-card ${scheduleType === "immediate" ? "active" : ""}`}>
              <input
                type="radio"
                name="scheduleType"
                checked={scheduleType === "immediate"}
                onChange={() => setScheduleType("immediate")}
              />
              <div>
                <strong>Publish Immediately</strong>
                <span>Process jobs right away when the background engine is running</span>
              </div>
            </label>

            <label className={`radio-card ${scheduleType === "scheduled" ? "active" : ""}`}>
              <input
                type="radio"
                name="scheduleType"
                checked={scheduleType === "scheduled"}
                onChange={() => setScheduleType("scheduled")}
              />
              <div>
                <strong>Schedule for Later</strong>
                <span>Set a specific date and time for automated publishing</span>
              </div>
            </label>
          </div>

          {scheduleType === "scheduled" && (
            <div className="schedule-datetime-picker">
              <label>
                <Calendar size={14} />
                <span>Publishing Date & Time:</span>
                <input
                  type="datetime-local"
                  value={scheduleDateTime}
                  onChange={(e) => setScheduleDateTime(e.target.value)}
                />
              </label>
              <span className="timezone-indicator">
                <Clock size={12} /> Timezone: {timezone}
              </span>
            </div>
          )}
        </div>

        {/* Calculation summary */}
        <div className="job-calculation-summary">
          <div className="calc-row">
            <span>Selected Content Items:</span>
            <strong>{selectedContentIds.size}</strong>
          </div>
          <div className="calc-row">
            <span>Target Pinterest Accounts:</span>
            <strong>{selectedAccountIds.size}</strong>
          </div>
          <div className="calc-row total-calc-row">
            <span>Total Publishing Jobs to Create:</span>
            <strong>{totalJobsCount}</strong>
          </div>
        </div>

        {/* Explicit Approval Checkbox */}
        <div className="explicit-approval-box">
          <label className="approval-checkbox-label">
            <input
              type="checkbox"
              checked={approvedByUser}
              onChange={(e) => setApprovedByUser(e.target.checked)}
            />
            <span>
              <strong>Explicit User Approval:</strong> I have reviewed the target accounts, board selections, and content items. I explicitly approve creating and executing these {totalJobsCount} publishing jobs.
            </span>
          </label>
        </div>

        {/* Error / Success Notices */}
        {error && (
          <div className="workspace-error" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="feedback-message feedback-success" role="status">
            <CheckCircle2 size={15} />
            <span>{success} <Link href="/pinterest/queue" style={{ textDecoration: "underline", fontWeight: "bold" }}>View Queue →</Link></span>
          </div>
        )}

        <div className="wizard-submit-bar">
          <button
            className="primary-button submit-publish-button"
            type="button"
            disabled={
              submitting ||
              totalJobsCount === 0 ||
              !approvedByUser
            }
            onClick={() => void handleSchedulePublishing()}
          >
            {submitting ? (
              <LoaderCircle size={16} className="spinning" />
            ) : (
              <Send size={16} />
            )}
            <span>
              {submitting
                ? "Creating publishing jobs..."
                : `Schedule ${totalJobsCount} Publishing Job${totalJobsCount === 1 ? "" : "s"}`}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

