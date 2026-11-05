import { DashboardShell } from "@/components/dashboard-shell";
import { EngineController } from "@/components/pinterest/engine-controller";
import { Cpu } from "lucide-react";

export const dynamic = "force-dynamic";

export default function PinterestEnginePage() {
  return (
    <DashboardShell activeSection="pinterest-engine">
      <div className="page-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">PINTEREST ENGINE</div>
            <h1>Engine Controller & Settings</h1>
            <p className="page-description">
              Start, pause, resume, and configure the background publishing engine.
            </p>
          </div>
          <div className="date-chip">
            <Cpu size={15} />
            <span>SQLite Worker Queue</span>
          </div>
        </div>

        <EngineController />
      </div>
    </DashboardShell>
  );
}

