import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

export const CONTENT_EXPORT_COLUMNS = [
  "Content_ID",
  "Niche",
  "Target_Country",
  "Target_Audience",
  "Content_Idea",
  "Research_Insight",
  "Idea_Score",
  "Pinterest_Title",
  "Pinterest_Description",
  "Hashtags",
  "Keywords",
  "Image_Prompt",
  "Image_Path",
  "Destination_URL",
  "Image_Status",
  "Generated_At",
] as const;

export interface ContentExportRow {
  contentId: string;
  niche: string;
  targetCountry: string;
  targetAudience: string;
  contentIdea: string;
  researchInsight: string;
  ideaScore: number;
  pinterestTitle: string;
  pinterestDescription: string;
  hashtags: string[];
  keywords: string[];
  imagePrompt: string;
  imagePath: string;
  destinationUrl: string;
  imageStatus: string;
  generatedAt: Date;
}

export interface ExecutionWorkbook {
  niche: string;
  executionDate: string;
  rows: ContentExportRow[];
}

function truncateExcelName(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

export function createWorksheetName(
  niche: string,
  executionDate: string,
  existingNames: string[] = [],
): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(executionDate);
  if (!dateMatch) {
    throw new Error("Execution date must use YYYY-MM-DD.");
  }
  const parsedDate = new Date(
    Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])),
  );
  if (
    parsedDate.getUTCFullYear() !== Number(dateMatch[1]) ||
    parsedDate.getUTCMonth() !== Number(dateMatch[2]) - 1 ||
    parsedDate.getUTCDate() !== Number(dateMatch[3])
  ) {
    throw new Error("Execution date must be a valid calendar date.");
  }

  const safeNiche = niche
    .replace(/[\[\]:*?\/\\]/g, "")
    .replace(/\s+/g, "")
    .replace(/^'+|'+$/g, "")
    .trim();
  const base = `${safeNiche || "Niche"}_${executionDate}`;
  const existing = new Set(existingNames.map((name) => name.toLocaleLowerCase("en")));

  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const tail = suffix === 1 ? "" : `_${suffix}`;
    const name = `${truncateExcelName(base, 31 - tail.length)}${tail}`;
    if (!existing.has(name.toLocaleLowerCase("en"))) {
      return name;
    }
  }

  throw new Error("Could not generate a unique worksheet name.");
}

export function addExecutionWorksheet(
  workbook: ExcelJS.Workbook,
  execution: ExecutionWorkbook,
): string {
  const worksheetName = createWorksheetName(
    execution.niche,
    execution.executionDate,
    workbook.worksheets.map((worksheet) => worksheet.name),
  );
  const worksheet = workbook.addWorksheet(worksheetName);

  worksheet.addRow([...CONTENT_EXPORT_COLUMNS]);
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF2D7159" },
  };
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.columns = [
    { width: 22 },
    { width: 22 },
    { width: 18 },
    { width: 20 },
    { width: 34 },
    { width: 40 },
    { width: 12 },
    { width: 38 },
    { width: 60 },
    { width: 28 },
    { width: 28 },
    { width: 65 },
    { width: 38 },
    { width: 38 },
    { width: 18 },
    { width: 24 },
  ];

  for (const row of execution.rows) {
    worksheet.addRow([
      row.contentId,
      row.niche,
      row.targetCountry,
      row.targetAudience,
      row.contentIdea,
      row.researchInsight,
      row.ideaScore,
      row.pinterestTitle,
      row.pinterestDescription,
      row.hashtags.join(" "),
      row.keywords.join(", "),
      row.imagePrompt,
      row.imagePath,
      row.destinationUrl,
      row.imageStatus,
      row.generatedAt.toISOString(),
    ]);
  }

  return worksheetName;
}

export async function exportExecutionWorkbook(
  sourcePath: string,
  destinationPath: string,
  execution: ExecutionWorkbook,
): Promise<string> {
  const source = path.resolve(sourcePath);
  const destination = path.resolve(destinationPath);
  if (source.toLocaleLowerCase("en") === destination.toLocaleLowerCase("en")) {
    throw new Error("Export must not overwrite the uploaded source workbook.");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(source);
  const worksheetName = addExecutionWorksheet(workbook, execution);
  const temporaryPath = `${destination}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(destination), { recursive: true });

  try {
    await workbook.xlsx.writeFile(temporaryPath);
    await rename(temporaryPath, destination);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Could not remove incomplete Excel export", cleanupError);
      }
    }
    throw error;
  }

  return worksheetName;
}
