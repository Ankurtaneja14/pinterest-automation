import { DashboardShell } from "@/components/dashboard-shell";
import { QueueManager } from "@/components/pinterest/queue-manager";
import { ListOrdered } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PinterestQueuePage() {
  return (
    <DashboardShell activeSection="pinterest-queue">
      <div className="page-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">PINTEREST ENGINE</div>
            <h1>Publishing Queue</h1>
            <p className="page-description">
              Manage active, pending, and scheduled multi-account Pinterest publishing jobs.
            </p>
          </div>
          <div className="date-chip">
            <ListOrdered size={15} />
            <span>Persistent Queue</span>
          </div>
        </div>

        <QueueManager />
      </div>
    </DashboardShell>
  );
}

