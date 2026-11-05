import { CalendarClock } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ScheduleImporter } from "@/components/schedule-importer";
import { ScheduleList } from "@/components/schedule-list";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function SchedulesPage() {
  const [schedules, scheduleCount] = await Promise.all([
    prisma.nicheSchedule.findMany({
      orderBy: [{ executionDate: "asc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.nicheSchedule.count(),
  ]);

  const serializedSchedules = schedules.map((schedule) => ({
    id: schedule.id,
    niche: schedule.niche,
    executionDate: schedule.executionDate.toISOString(),
    targetCountry: schedule.targetCountry,
    targetAudience: schedule.targetAudience,
    language: schedule.language,
    researchIdeasCount: schedule.researchIdeasCount,
    pinsToGenerate: schedule.pinsToGenerate,
    status: schedule.status,
  }));

  return (
    <DashboardShell activeSection="schedules">
      <div className="page-content schedules-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">EXECUTION PLANNING</div>
            <h1>Schedule management</h1>
            <p className="page-description">
              Import and review niche schedules from your Excel workbook.
            </p>
          </div>
          <div className="date-chip">
            <CalendarClock size={15} />
            <span>{scheduleCount} saved schedules</span>
          </div>
        </div>

        <ScheduleImporter />

        <section className="panel schedules-panel">
          <div className="panel-heading">
            <div>
              <h2>Imported schedules</h2>
              <p>
                The database is the source of truth; repeated workbook uploads
                update pending records rather than duplicating them.
              </p>
            </div>
          </div>
          {serializedSchedules.length === 0 ? (
            <div className="schedule-empty">
              <CalendarClock size={20} className="schedule-empty-icon" />
              <strong>No schedules imported</strong>
              <span>Upload a workbook above to populate this table.</span>
            </div>
          ) : (
            <ScheduleList
              initialSchedules={serializedSchedules}
              totalCount={scheduleCount}
            />
          )}
        </section>
      </div>
    </DashboardShell>
  );
}
