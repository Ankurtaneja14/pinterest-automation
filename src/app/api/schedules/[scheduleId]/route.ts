import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/server/security/request-origin";
import {
  deleteSchedule,
  ScheduleNotFoundError,
} from "@/server/excel/schedule-service";

export const runtime = "nodejs";

const SCHEDULE_ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

type Params = { params: Promise<{ scheduleId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  }

  const { scheduleId } = await params;
  if (!SCHEDULE_ID_RE.test(scheduleId)) {
    return NextResponse.json({ error: "Invalid schedule ID." }, { status: 400 });
  }

  try {
    const deleted = await deleteSchedule(scheduleId);
    return NextResponse.json({
      ok: true,
      message: `Schedule "${deleted.niche}" deleted successfully.`,
    });
  } catch (error) {
    if (error instanceof ScheduleNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Failed to delete schedule:", error);
    return NextResponse.json(
      { error: "Could not delete schedule." },
      { status: 500 },
    );
  }
}

