import { DashboardShell } from "@/components/dashboard-shell";
import { HistoryMonitor } from "@/components/pinterest/history-monitor";
import { History } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PinterestHistoryPage() {
  return (
    <DashboardShell activeSection="pinterest-history">
      <div className="page-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">PINTEREST ENGINE</div>
            <h1>Publishing History</h1>
            <p className="page-description">
              Permanent audit log of all completed, published, and failed multi-account publishing operations.
            </p>
          </div>
          <div className="date-chip">
            <History size={15} />
            <span>Audited History</span>
          </div>
        </div>

        <HistoryMonitor />
      </div>
    </DashboardShell>
  );
}

