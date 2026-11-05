import { DashboardShell } from "@/components/dashboard-shell";
import { AccountManager } from "@/components/pinterest/account-manager";
import { Users } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PinterestAccountsPage() {
  return (
    <DashboardShell activeSection="pinterest-accounts">
      <div className="page-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">PINTEREST ENGINE</div>
            <h1>Pinterest Accounts</h1>
            <p className="page-description">
              Connect and manage up to 50 Pinterest accounts for multi-account publishing.
            </p>
          </div>
          <div className="date-chip">
            <Users size={15} />
            <span>OAuth 2.0 PKCE</span>
          </div>
        </div>

        <AccountManager />
      </div>
    </DashboardShell>
  );
}

