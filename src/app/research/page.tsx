import { Search } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ResearchWorkspace } from "@/components/research-workspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const schedules = await prisma.nicheSchedule.findMany({
    orderBy: [{ executionDate: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      niche: true,
      targetCountry: true,
      targetAudience: true,
      language: true,
      executionDate: true,
    },
  });

  return (
    <DashboardShell activeSection="research">
      <div className="page-content research-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">EVIDENCE-GROUNDED DISCOVERY</div>
            <h1>Research workspace</h1>
            <p className="page-description">
              Retrieve current public search results and synthesize cited
              audience insights and content opportunities.
            </p>
          </div>
          <div className="date-chip">
            <Search size={15} />
            <span>Bing public search + configured AI</span>
          </div>
        </div>
        <ResearchWorkspace
          schedules={schedules.map((schedule) => ({
            ...schedule,
            executionDate: schedule.executionDate.toISOString().slice(0, 10),
          }))}
        />
      </div>
    </DashboardShell>
  );
}
