"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Image from "next/image";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Key,
  Layers,
  LoaderCircle,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unlink,
  Users,
} from "lucide-react";

interface Board {
  id: string;
  pinterestBoardId: string;
  name: string;
  description: string | null;
  privacy: string | null;
  isDefault: boolean;
  status: string;
}

interface Account {
  id: string;
  pinterestUserId: string;
  username: string;
  displayName: string;
  profileImage: string | null;
  status: string;
  lastAuthenticatedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  _count: {
    boards: number;
    publishingJobs: number;
  };
}

export function AccountManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [connecting, setConnecting] = useState(false);
  const [startingBrowserLogin, setStartingBrowserLogin] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Browser login session state
  const [browserSessionId, setBrowserSessionId] = useState<string | null>(null);
  const [browserSessionStatus, setBrowserSessionStatus] = useState<string>("waiting_for_login");
  const [browserSessionMessage, setBrowserSessionMessage] = useState<string>("");
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Board management modal state
  const [activeBoardAccount, setActiveBoardAccount] = useState<Account | null>(null);
  const [boards, setBoards] = useState<Board[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [syncingBoards, setSyncingBoards] = useState(false);

  async function loadAccounts() {
    try {
      const res = await fetch("/api/pinterest/accounts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load accounts.");
      setAccounts(data.accounts || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) {
      setNotice("Pinterest account connected successfully!");
      window.history.replaceState({}, "", "/pinterest/accounts");
    } else if (params.get("error")) {
      const err = params.get("error");
      setError(
        err === "limit_reached"
          ? "Account limit reached (max 50 accounts)."
          : `Connection failed: ${err}`,
      );
      window.history.replaceState({}, "", "/pinterest/accounts");
    }
  }, []);

  // Poll active browser session
  useEffect(() => {
    if (browserSessionId && browserSessionStatus !== "complete" && browserSessionStatus !== "failed" && browserSessionStatus !== "cancelled") {
      pollTimerRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/pinterest/session?sessionId=${encodeURIComponent(browserSessionId)}`);
          const data = await res.json();
          if (data.status) {
            setBrowserSessionStatus(data.status);
            if (data.message) setBrowserSessionMessage(data.message);

            if (data.status === "complete") {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              setNotice(data.message || "Account connected successfully with saved session!");
              await loadAccounts();
              setTimeout(() => {
                setBrowserSessionId(null);
              }, 2000);
            } else if (data.status === "failed") {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
              setError(data.message || "Failed to capture Pinterest session.");
            } else if (data.status === "cancelled") {
              if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            }
          }
        } catch {
          // ignore transient poll error
        }
      }, 2000);
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [browserSessionId, browserSessionStatus]);

  async function startBrowserLogin() {
    setStartingBrowserLogin(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/pinterest/session", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not open Pinterest browser login.");

      setBrowserSessionId(data.sessionId);
      setBrowserSessionStatus("waiting_for_login");
      setBrowserSessionMessage("Chrome window opened. Please log in to your Pinterest account in the opened window.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start browser login.");
    } finally {
      setStartingBrowserLogin(false);
    }
  }

  async function cancelBrowserLogin() {
    if (browserSessionId) {
      try {
        await fetch(`/api/pinterest/session?sessionId=${encodeURIComponent(browserSessionId)}`, {
          method: "DELETE",
        });
      } catch {}
    }
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setBrowserSessionId(null);
  }

  async function startConnectOAuth() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/pinterest/oauth/connect", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start Pinterest OAuth.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "OAuth connection failed.");
      setConnecting(false);
    }
  }

  async function syncAccount(accountId: string) {
    setActionLoadingId(accountId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/pinterest/accounts/${accountId}/sync`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed.");
      setNotice("Account profile and boards synced successfully.");
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function disconnectAccount(accountId: string) {
    if (!window.confirm("Are you sure you want to disconnect this account? Scheduled jobs will be cancelled.")) {
      return;
    }
    setActionLoadingId(accountId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/pinterest/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Disconnect failed.");
      setNotice("Account disconnected.");
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function deleteAccount(accountId: string) {
    if (!window.confirm("Permanently remove this account and all associated job records? This cannot be undone.")) {
      return;
    }
    setActionLoadingId(accountId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/pinterest/accounts/${accountId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      setNotice("Account deleted.");
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function openBoardsModal(account: Account) {
    setActiveBoardAccount(account);
    setLoadingBoards(true);
    setBoards([]);
    try {
      const res = await fetch(`/api/pinterest/accounts/${account.id}/boards`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load boards.");
      setBoards(data.boards || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading boards.");
    } finally {
      setLoadingBoards(false);
    }
  }

  async function syncBoardsForModal() {
    if (!activeBoardAccount) return;
    setSyncingBoards(true);
    try {
      const res = await fetch(`/api/pinterest/accounts/${activeBoardAccount.id}/boards`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Board sync failed.");
      setBoards(data.boards || []);
      setNotice("Boards synchronized from Pinterest.");
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Board sync failed.");
    } finally {
      setSyncingBoards(false);
    }
  }

  async function setDefaultBoard(boardId: string) {
    if (!activeBoardAccount) return;
    try {
      const res = await fetch(`/api/pinterest/accounts/${activeBoardAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setDefaultBoard", boardId }),
      });
      if (!res.ok) throw new Error("Could not set default board.");
      setBoards((prev) =>
        prev.map((b) => ({ ...b, isDefault: b.id === boardId })),
      );
      setNotice("Default publishing board updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set default board.");
    }
  }

  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const matchSearch =
        acc.username.toLowerCase().includes(search.toLowerCase()) ||
        acc.displayName.toLowerCase().includes(search.toLowerCase()) ||
        acc.pinterestUserId.includes(search);
      const matchStatus =
        statusFilter === "ALL" || acc.status.toUpperCase() === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [accounts, search, statusFilter]);

  return (
    <div className="pinterest-workspace">
      {/* Top action bar */}
      <section className="panel account-header-panel">
        <div className="panel-heading">
          <div>
            <h2>Connected Pinterest Accounts</h2>
            <p>
              Connect up to 50 Pinterest accounts. Log in directly via Chrome to save session cookies for headless uploading, or connect via official OAuth.
            </p>
          </div>
          <div className="account-counter-badge">
            <Users size={16} />
            <span>{accounts.length} / 50 accounts</span>
          </div>
        </div>

        <div className="account-action-row">
          <div className="search-filter-group">
            <div className="search-input-box">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search username, display name, ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All statuses</option>
              <option value="CONNECTED">Connected</option>
              <option value="AUTHENTICATIONEXPIRED">Auth Expired</option>
              <option value="DISCONNECTED">Disconnected</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              className="primary-button"
              type="button"
              disabled={startingBrowserLogin || connecting || accounts.length >= 50}
              onClick={() => void startBrowserLogin()}
              title="Open a Chrome window to log into your Pinterest account and save session tokens for headless uploading"
            >
              {startingBrowserLogin ? (
                <LoaderCircle size={15} className="spinning" />
              ) : (
                <LogIn size={15} />
              )}
              <span>Log in to Pinterest</span>
            </button>

            <button
              className="secondary-button"
              type="button"
              disabled={connecting || startingBrowserLogin || accounts.length >= 50}
              onClick={() => void startConnectOAuth()}
              title="Connect using Pinterest Developer App OAuth 2.0"
            >
              <Key size={14} />
              <span>Connect via OAuth</span>
            </button>
          </div>
        </div>
      </section>

      {/* Alerts */}
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

      {/* Account List */}
      {loading ? (
        <section className="panel image-empty-panel">
          <LoaderCircle size={20} className="spinning" />
          <span>Loading Pinterest accounts...</span>
        </section>
      ) : filteredAccounts.length === 0 ? (
        <section className="panel image-empty-panel">
          <Users size={24} />
          <strong>No Pinterest accounts connected</strong>
          <span>
            {accounts.length === 0
              ? "Click 'Log in to Pinterest' to open a browser window and save your session for headless pin uploading."
              : "No accounts match your search filter."}
          </span>
          {accounts.length === 0 && (
            <button
              className="primary-button"
              type="button"
              onClick={() => void startBrowserLogin()}
            >
              <LogIn size={14} />
              Log in to Pinterest
            </button>
          )}
        </section>
      ) : (
        <div className="account-cards-grid">
          {filteredAccounts.map((account) => {
            const isLoading = actionLoadingId === account.id;
            const isConnected = account.status === "Connected";
            return (
              <article className="panel account-card" key={account.id}>
                <div className="account-card-header">
                  <div className="account-avatar-frame">
                    {account.profileImage ? (
                      <Image
                        src={account.profileImage}
                        alt={account.displayName}
                        width={44}
                        height={44}
                        className="account-avatar-img"
                        unoptimized
                      />
                    ) : (
                      <div className="account-avatar-fallback">
                        {account.displayName.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="account-identity">
                    <h3>{account.displayName}</h3>
                    <a
                      href={`https://pinterest.com/${encodeURIComponent(account.username)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="account-username-link"
                    >
                      @{account.username}
                      <ExternalLink size={12} />
                    </a>
                  </div>
                  <span className={`status-pill status-${account.status.toLowerCase()}`}>
                    {account.status}
                  </span>
                </div>

                <div className="account-stats-row">
                  <div className="stat-item">
                    <span className="stat-label">Boards</span>
                    <strong className="stat-value">{account._count.boards}</strong>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Publishing Jobs</span>
                    <strong className="stat-value">{account._count.publishingJobs}</strong>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Session Status</span>
                    <span className="stat-footnote">
                      {isConnected ? "Active session" : "Requires login"}
                    </span>
                  </div>
                </div>

                <div className="account-card-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => void openBoardsModal(account)}
                  >
                    <Layers size={14} />
                    <span>Boards ({account._count.boards})</span>
                  </button>

                  <button
                    className="secondary-button"
                    type="button"
                    disabled={isLoading || !isConnected}
                    onClick={() => void syncAccount(account.id)}
                    title="Synchronize profile and boards"
                  >
                    {isLoading ? (
                      <LoaderCircle size={14} className="spinning" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    <span>Sync</span>
                  </button>

                  {isConnected ? (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={isLoading}
                      onClick={() => void disconnectAccount(account.id)}
                      title="Disconnect session"
                    >
                      <Unlink size={14} />
                      <span>Disconnect</span>
                    </button>
                  ) : (
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => void startBrowserLogin()}
                    >
                      <LogIn size={14} />
                      <span>Log in to Reconnect</span>
                    </button>
                  )}

                  <button
                    className="secondary-button image-remove-button"
                    type="button"
                    disabled={isLoading}
                    onClick={() => void deleteAccount(account.id)}
                    title="Permanently remove account"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Browser Login In-Progress Modal */}
      {browserSessionId && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: "480px" }}>
            <div className="modal-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Globe size={20} color="var(--green)" />
                <div>
                  <h3 style={{ margin: 0 }}>Pinterest Browser Login</h3>
                  <p style={{ margin: 0 }}>Chrome window opened for authentication</p>
                </div>
              </div>
            </div>

            <div className="modal-body" style={{ textAlign: "center", padding: "28px 20px" }}>
              {browserSessionStatus === "complete" ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <CheckCircle2 size={40} color="#2d7159" />
                  <strong style={{ fontSize: "15px" }}>Login Successful!</strong>
                  <p style={{ color: "#616f67", fontSize: "13px", margin: 0 }}>
                    {browserSessionMessage}
                  </p>
                </div>
              ) : browserSessionStatus === "extracting_data" ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <LoaderCircle size={36} className="spinning" color="#2d7159" />
                  <strong style={{ fontSize: "14px" }}>Capturing Session & Tokens...</strong>
                  <p style={{ color: "#616f67", fontSize: "12px", margin: 0 }}>
                    Extracting session cookies, tokens, profile details, and boards for headless publishing.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
                  <div style={{ position: "relative" }}>
                    <LoaderCircle size={40} className="spinning" color="#2d7159" />
                  </div>
                  <div>
                    <strong style={{ fontSize: "14px", display: "block", marginBottom: "4px" }}>
                      Waiting for you to log in...
                    </strong>
                    <p style={{ color: "#616f67", fontSize: "12px", margin: 0, lineHeight: 1.5 }}>
                      Please log in to your Pinterest account in the newly opened Google Chrome window.
                      Your session ID, auth cookies, and tokens will be captured automatically for headless uploading.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: "center" }}>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void cancelBrowserLogin()}
              >
                Cancel Login
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Boards Modal */}
      {activeBoardAccount && (
        <div className="modal-backdrop" onClick={() => setActiveBoardAccount(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Pinterest Boards for @{activeBoardAccount.username}</h3>
                <p>Select a default publishing board or refresh boards from Pinterest.</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                disabled={syncingBoards}
                onClick={() => void syncBoardsForModal()}
              >
                {syncingBoards ? (
                  <LoaderCircle size={14} className="spinning" />
                ) : (
                  <RefreshCw size={14} />
                )}
                <span>Refresh from Pinterest</span>
              </button>
            </div>

            <div className="modal-body">
              {loadingBoards ? (
                <div className="modal-loading">
                  <LoaderCircle size={20} className="spinning" />
                  <span>Loading boards...</span>
                </div>
              ) : boards.length === 0 ? (
                <div className="modal-empty">
                  <Layers size={22} />
                  <span>No boards found for this account. Click Refresh to sync from Pinterest.</span>
                </div>
              ) : (
                <div className="boards-list">
                  {boards.map((board) => (
                    <div className="board-row" key={board.id}>
                      <div className="board-info">
                        <strong>{board.name}</strong>
                        {board.description && <p>{board.description}</p>}
                        <span className="board-id-caption">ID: {board.pinterestBoardId}</span>
                      </div>
                      <div className="board-actions">
                        {board.isDefault ? (
                          <span className="default-board-tag">Default Board</span>
                        ) : (
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => void setDefaultBoard(board.id)}
                          >
                            Set as Default
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="primary-button"
                type="button"
                onClick={() => setActiveBoardAccount(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
