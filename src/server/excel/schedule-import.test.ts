import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { createScheduleKey, parseScheduleWorkbook } from "./schedule-import";

const headers = [
  "Niche",
  "Execution_Date",
  "Target_Country",
  "Target_Audience",
  "Language",
  "Research_Ideas_Count",
  "Pins_To_Generate",
  "Destination_URL",
  "Status",
];

async function workbookBuffer(
  rows: unknown[][],
  sheetName = "Niche_Schedule",
  columns = headers,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.addRow(columns);
  for (const row of rows) {
    worksheet.addRow(row);
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("parseScheduleWorkbook", () => {
  it("parses valid schedules, Excel dates, and ignores empty rows", async () => {
    const file = await workbookBuffer([
      [
        "Home Decor",
        new Date("2026-11-03T00:00:00.000Z"),
        "USA",
        "Gen Z",
        "English",
        40,
        10,
        "https://example.com/home-decor",
        "",
      ],
      ["", "", "", "", "", "", "", "", ""],
    ]);

    const result = await parseScheduleWorkbook(file);

    expect(result.issues).toEqual([]);
    expect(result.totalRows).toBe(1);
    expect(result.validRows).toHaveLength(1);
    expect(result.validRows[0]).toMatchObject({
      niche: "Home Decor",
      executionDate: "2026-11-03",
      researchIdeasCount: 40,
      pinsToGenerate: 10,
      status: "Pending",
      sourceRow: 2,
    });
    expect(result.validRows[0].scheduleKey).toHaveLength(64);
  });

  it("uses niche, date, and audience configuration for stable schedule identity", () => {
    const identity = {
      niche: "Home Decor",
      executionDate: "2026-11-03",
      targetCountry: "USA",
      targetAudience: "Gen Z",
      language: "English",
    };

    expect(
      createScheduleKey({ ...identity, niche: "home decor" }),
    ).toBe(createScheduleKey(identity));
    expect(
      createScheduleKey({ ...identity, targetCountry: "Canada" }),
    ).not.toBe(createScheduleKey(identity));
  });

  it("reports all row validation failures without importing invalid rows", async () => {
    const file = await workbookBuffer([
      [
        "Digital Art",
        "2026-02-30",
        "USA",
        "",
        "English",
        0,
        8,
        "javascript:alert(1)",
        "Running",
      ],
    ]);

    const result = await parseScheduleWorkbook(file);

    expect(result.validRows).toEqual([]);
    expect(result.issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        "executionDate",
        "targetAudience",
        "researchIdeasCount",
        "destinationUrl",
        "status",
      ]),
    );
  });

  it("reads destination links from Excel hyperlink cells", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Niche_Schedule");
    worksheet.addRow(headers);
    worksheet.addRow([
      "Digital Art",
      "2026-11-04",
      "USA",
      "Gen Z",
      "English",
      30,
      8,
      { text: "Explore digital art", hyperlink: "https://example.com/digital-art" },
      "Pending",
    ]);

    const result = await parseScheduleWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );

    expect(result.issues).toEqual([]);
    expect(result.validRows[0].destinationUrl).toBe(
      "https://example.com/digital-art",
    );
  });

  it("reports duplicate schedules in a workbook", async () => {
    const row = [
      "Digital Art",
      "2026-11-04",
      "USA",
      "Gen Z",
      "English",
      30,
      8,
      "https://example.com/digital-art",
      "Pending",
    ];
    const updatedDestination = [...row];
    updatedDestination[7] = "https://example.com/another-destination";
    const file = await workbookBuffer([row, updatedDestination]);

    const result = await parseScheduleWorkbook(file);

    expect(result.validRows).toHaveLength(1);
    expect(result.issues).toEqual([
      expect.objectContaining({
        rowNumber: 3,
        field: "schedule",
      }),
    ]);
  });

  it("requires the input worksheet and all required columns", async () => {
    const missingSheet = await workbookBuffer([], "Schedule");
    const missingColumns = await workbookBuffer([], "Niche_Schedule", ["Niche"]);

    await expect(parseScheduleWorkbook(missingSheet)).resolves.toMatchObject({
      sheetName: null,
      issues: [expect.objectContaining({ message: expect.stringContaining("Niche_Schedule") })],
    });
    await expect(parseScheduleWorkbook(missingColumns)).resolves.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringContaining("Missing required columns") })],
    });
  });

  it("rejects malformed workbook data", async () => {
    await expect(parseScheduleWorkbook(Buffer.from("not an xlsx file"))).rejects.toThrow();
  });
});
