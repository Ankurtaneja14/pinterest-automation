import { KeyRound } from "lucide-react";
import { AISettings } from "@/components/ai-settings";
import { DashboardShell } from "@/components/dashboard-shell";

export default function AISettingsPage() {
  return (
    <DashboardShell activeSection="settings">
      <div className="page-content ai-settings-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">PROVIDER CONNECTIONS</div>
            <h1>AI configuration</h1>
            <p className="page-description">
              Configure secure OpenAI-compatible models for the production
              stages.
            </p>
          </div>
          <div className="date-chip">
            <KeyRound size={15} />
            <span>Server-side encrypted</span>
          </div>
        </div>
        <AISettings />
      </div>
    </DashboardShell>
  );
}
