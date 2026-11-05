import { Images } from "lucide-react";
import { DashboardShell } from "@/components/dashboard-shell";
import { ImageWorkspace } from "@/components/image-workspace";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function ImagesPage() {
  const sessions = await prisma.researchSession.findMany({
    where: { status: "Complete", reportJson: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      execution: {
        select: {
          schedule: {
            select: {
              niche: true,
              targetCountry: true,
              targetAudience: true,
            },
          },
          selectedIdeas: {
            where: { selected: true },
            select: { id: true },
          },
        },
      },
    },
  });
  const targets = sessions.flatMap((session) =>
    session.execution.selectedIdeas.length > 0
      ? [
          {
            researchSessionId: session.id,
            niche: session.execution.schedule.niche,
            targetCountry: session.execution.schedule.targetCountry,
            targetAudience: session.execution.schedule.targetAudience,
          },
        ]
      : [],
  );

  return (
    <DashboardShell activeSection="images">
      <div className="page-content">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">PIN ASSET PRODUCTION</div>
            <h1>Generated images</h1>
            <p className="page-description">
              Generate and review images for your selected Pinterest content.
            </p>
          </div>
          <div className="date-chip">
            <Images size={15} />
            <span>Hugging Face Inference</span>
          </div>
        </div>
        <ImageWorkspace targets={targets} />
      </div>
    </DashboardShell>
  );
}
