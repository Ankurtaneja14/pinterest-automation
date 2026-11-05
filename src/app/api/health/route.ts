import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      database: "ok",
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health check database query failed", error);
    return NextResponse.json(
      {
        status: "degraded",
        database: "unavailable",
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
