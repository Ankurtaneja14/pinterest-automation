import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import { importSchedules } from "@/server/excel/schedule-service";
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
    console.error("Could not parse schedule workbook for import", error);
    return NextResponse.json(
      { error: "The workbook is malformed or cannot be opened." },
      { status: 422 },
    );
  }

  if (preview.issues.length > 0) {
    return NextResponse.json(
      {
        error: "Resolve all workbook validation issues before importing.",
        issues: preview.issues,
      },
      { status: 422 },
    );
  }
  if (preview.validRows.length === 0) {
    return NextResponse.json(
      { error: "The workbook contains no non-empty schedule rows." },
      { status: 422 },
    );
  }

  try {
    const result = await importSchedules(file, preview.validRows);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("Could not import schedules into SQLite", error);
    return NextResponse.json(
      { error: "Schedule import failed. The workbook was not imported." },
      { status: 500 },
    );
  }
}
