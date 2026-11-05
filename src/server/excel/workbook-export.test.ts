import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  createWorksheetName,
  exportExecutionWorkbook,
  type ExecutionWorkbook,
} from "./workbook-export";

const execution: ExecutionWorkbook = {
  niche: "Home Decor",
  executionDate: "2026-11-03",
  rows: [
    {
      contentId: "content-1",
      niche: "Home Decor",
      targetCountry: "USA",
      targetAudience: "Gen Z",
      contentIdea: "Small-space storage",
      researchInsight: "Renters value reversible organization.",
      ideaScore: 87.5,
      pinterestTitle: "Small Space Storage Ideas",
      pinterestDescription: "A useful guide for compact homes.",
      hashtags: ["#homedecor", "#smallspaces"],
      keywords: ["small-space storage", "renter-friendly"],
      imagePrompt: "A bright, vertical editorial room scene.",
      imagePath: "Home_Decor/2026-11-03/pin_001.png",
      destinationUrl: "https://example.com/home-decor",
      imageStatus: "Pending",
      generatedAt: new Date("2026-11-03T10:00:00.000Z"),
    },
  ],
};

describe("Excel execution export", () => {
  it("sanitizes worksheet names, caps them at 31 characters, and avoids duplicates", () => {
    const name = createWorksheetName("Home Decor:*", "2026-11-03");
    const duplicate = createWorksheetName("Home Decor:*", "2026-11-03", [name]);
    const longName = createWorksheetName(
      "A niche name that is much longer than Excel permits",
      "2026-11-03",
    );

    expect(name).toBe("HomeDecor_2026-11-03");
    expect(duplicate).not.toBe(name);
    expect(duplicate.length).toBeLessThanOrEqual(31);
    expect(longName.length).toBeLessThanOrEqual(31);
    expect(() => createWorksheetName("Art", "2026-02-30")).toThrow(
      "valid calendar date",
    );
  });

  it("writes the required row shape to a new sheet and preserves the source workbook", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pce-excel-"));
    const sourcePath = path.join(directory, "input.xlsx");
    const outputPath = path.join(directory, "output.xlsx");
    const source = new ExcelJS.Workbook();
    source.addWorksheet("Niche_Schedule").addRow(["original schedule data"]);
    source.addWorksheet("Existing_Report").addRow(["keep this sheet"]);
    await source.xlsx.writeFile(sourcePath);

    try {
      const sheetName = await exportExecutionWorkbook(
        sourcePath,
        outputPath,
        execution,
      );
      const exported = new ExcelJS.Workbook();
      await exported.xlsx.readFile(outputPath);
      const outputSheet = exported.getWorksheet(sheetName);
      const original = new ExcelJS.Workbook();
      await original.xlsx.readFile(sourcePath);

      expect(exported.worksheets.map((sheet) => sheet.name)).toEqual([
        "Niche_Schedule",
        "Existing_Report",
        "HomeDecor_2026-11-03",
      ]);
      expect(outputSheet?.getRow(1).getCell(1).value).toBe("Content_ID");
      expect(outputSheet?.getRow(2).getCell(1).value).toBe("content-1");
      expect(outputSheet?.getRow(2).getCell(10).value).toBe(
        "#homedecor #smallspaces",
      );
      expect(original.worksheets.map((sheet) => sheet.name)).toEqual([
        "Niche_Schedule",
        "Existing_Report",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
