import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasSameOrigin } from "@/server/security/request-origin";
import { parseScheduleWorkbook } from "@/server/excel/schedule-import";
import { readWorkbookUpload } from "@/server/excel/upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  let file: Buffer;
  try {
    file = await readWorkbookUpload(request);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The workbook could not be read.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  let preview;
  try {
    preview = await parseScheduleWorkbook(file);
  } catch (error) {
    console.error("Could not parse schedule workbook", error);
    return NextResponse.json(
      { error: "The workbook is malformed or cannot be opened." },
      { status: 422 },
    );
  }

  try {
    const existing = await prisma.nicheSchedule.findMany({
      where: {
        scheduleKey: { in: preview.validRows.map((row) => row.scheduleKey) },
      },
      select: { scheduleKey: true, status: true },
    });
    const statusByKey = new Map(
      existing.map((schedule) => [schedule.scheduleKey, schedule.status]),
    );

    return NextResponse.json({
      ...preview,
      validRows: preview.validRows.map((row) => ({
        ...row,
        existingStatus: statusByKey.get(row.scheduleKey) ?? null,
      })),
    });
  } catch (error) {
    console.error("Could not check existing schedules during preview", error);
    return NextResponse.json(
      { error: "Schedule preview is temporarily unavailable." },
      { status: 503 },
    );
  }
}
