import { Lightbulb } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { IdeaWorkspace } from "@/components/idea-workspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const sessions = await prisma.researchSession.findMany({
    where: { status: "Complete", reportJson: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      execution: {
        select: {
          schedule: {
            select: {
              id: true,
              niche: true,
              targetCountry: true,
              targetAudience: true,
              language: true,
              researchIdeasCount: true,
            },
          },
        },
      },
    },
  });
  const seenSchedules = new Set<string>();
  const targets = sessions.flatMap((session) => {
    const schedule = session.execution.schedule;
    if (seenSchedules.has(schedule.id)) {
      return [];
    }
    seenSchedules.add(schedule.id);
    return [{
      scheduleId: schedule.id,
      researchSessionId: session.id,
      niche: schedule.niche,
      targetCountry: schedule.targetCountry,
      targetAudience: schedule.targetAudience,
      language: schedule.language,
      requestedCount: schedule.researchIdeasCount,
    }];
  });

  return (
    <DashboardShell activeSection="ideas">
      <div className="page-content ideas-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">RESEARCH-DRIVEN PLANNING</div>
            <h1>Content ideas</h1>
            <p className="page-description">
              Turn a completed research report into distinct, cited Pinterest ideas.
            </p>
          </div>
          <div className="date-chip">
            <Lightbulb size={15} />
            <span>Generated from your research</span>
          </div>
        </div>
        <IdeaWorkspace targets={targets} />
      </div>
    </DashboardShell>
  );
}
