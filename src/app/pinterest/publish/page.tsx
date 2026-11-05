import { DashboardShell } from "@/components/dashboard-shell";
import { PublishWizard } from "@/components/pinterest/publish-wizard";
import { Send } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PinterestPublishPage() {
  return (
    <DashboardShell activeSection="pinterest-publish">
      <div className="page-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">PINTEREST ENGINE</div>
            <h1>Publishing Center</h1>
            <p className="page-description">
              Select existing Content Library items, choose target Pinterest accounts and boards, review, and schedule publishing jobs.
            </p>
          </div>
          <div className="date-chip">
            <Send size={15} />
            <span>Central Multi-Account Distribution</span>
          </div>
        </div>

        <PublishWizard />
      </div>
    </DashboardShell>
  );
}

