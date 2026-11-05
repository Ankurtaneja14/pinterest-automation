import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";

const REQUIRED_COLUMNS = [
  "Niche",
  "Execution_Date",
  "Target_Country",
  "Target_Audience",
  "Language",
  "Research_Ideas_Count",
  "Pins_To_Generate",
  "Destination_URL",
] as const;

const HEADER_COLUMNS = [...REQUIRED_COLUMNS, "Status"] as const;
const MAX_EXCEL_SERIAL = 2_958_465;
const SCHEDULE_STATUSES = [
  "Pending",
  "Queued",
  "Researching",
  "Generating Ideas",
  "Scoring",
  "Generating Content",
  "Generating Images",
  "Exporting",
  "Completed",
  "Partial Success",
  "Failed",
  "Paused",
  "Cancelled",
] as const;

const scheduleRowSchema = z.object({
  niche: z.string().trim().min(1, "Niche is required."),
  executionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an Excel date cell or YYYY-MM-DD."),
  targetCountry: z.string().trim().min(1, "Target country is required."),
  targetAudience: z.string().trim().min(1, "Target audience is required."),
  language: z.string().trim().min(1, "Language is required."),
  researchIdeasCount: z.number().int().positive(
    "Research ideas count must be a positive whole number.",
  ),
  pinsToGenerate: z.number().int().positive(
    "Pins to generate must be a positive whole number.",
  ),
  destinationUrl: z
    .string()
    .trim()
    .url("Destination URL must be a valid HTTP or HTTPS URL.")
    .refine(
      (value) => {
        try {
          return ["http:", "https:"].includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      { message: "Destination URL must use HTTP or HTTPS." },
    ),
  status: z.enum(SCHEDULE_STATUSES),
});

export type ScheduleImportRow = z.infer<typeof scheduleRowSchema> & {
  scheduleKey: string;
  sourceRow: number;
};

export interface ScheduleImportIssue {
  rowNumber?: number;
  field?: string;
  message: string;
}

export interface ScheduleWorkbookPreview {
  sheetName: string | null;
  totalRows: number;
  validRows: ScheduleImportRow[];
  issues: ScheduleImportIssue[];
}

function canonicalStatus(value: string): string {
  if (!value) {
    return "Pending";
  }
  return (
    SCHEDULE_STATUSES.find(
      (status) => status.toLocaleLowerCase("en") === value.toLocaleLowerCase("en"),
    ) ?? value
  );
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function cellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value instanceof Date || typeof value !== "object" || value === null) {
    return value;
  }

  if ("formula" in value || "sharedFormula" in value) {
    return undefined;
  }

  if ("hyperlink" in value && typeof value.hyperlink === "string") {
    return value.hyperlink;
  }

  if ("text" in value && typeof value.text === "string") {
    return value.text;
  }

  return undefined;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function dateValue(value: unknown): string {
  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" && value > 0 && value <= MAX_EXCEL_SERIAL) {
    date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000));
  } else if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) {
      return "";
    }
    date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (
      date.getUTCFullYear() !== Number(match[1]) ||
      date.getUTCMonth() !== Number(match[2]) - 1 ||
      date.getUTCDate() !== Number(match[3])
    ) {
      return "";
    }
  } else {
    return "";
  }

  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

function countValue(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  const text = textValue(value);
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

function normalizeUrl(value: string): string {
  return new URL(value).toString();
}

export function createScheduleKey(
  row: Pick<
    ScheduleImportRow,
    | "niche"
    | "executionDate"
    | "targetCountry"
    | "targetAudience"
    | "language"
  >,
): string {
  const identity = [
    row.niche.trim().toLocaleLowerCase("en"),
    row.executionDate,
    row.targetCountry.trim().toLocaleLowerCase("en"),
    row.targetAudience.trim().toLocaleLowerCase("en"),
    row.language.trim().toLocaleLowerCase("en"),
  ];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export async function parseScheduleWorkbook(
  file: Uint8Array,
): Promise<ScheduleWorkbookPreview> {
  const workbook = new ExcelJS.Workbook();
  const fileCopy = new ArrayBuffer(file.byteLength);
  new Uint8Array(fileCopy).set(file);
  await workbook.xlsx.load(fileCopy);

  const worksheet =
    workbook.worksheets.find(
      (sheet) => sheet.name.trim().toLocaleLowerCase("en") === "niche_schedule",
    ) ?? null;

  if (!worksheet) {
    return {
      sheetName: null,
      totalRows: 0,
      validRows: [],
      issues: [{ message: 'Workbook must contain a "Niche_Schedule" worksheet.' }],
    };
  }

  const headerRow = worksheet.getRow(1);
  const columnIndexes = new Map<string, number>();
  headerRow.eachCell((cell, column) => {
    const header = normalizeHeader(cell.text);
    if (header) {
      columnIndexes.set(header, column);
    }
  });

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !columnIndexes.has(normalizeHeader(column)),
  );
  if (missingColumns.length > 0) {
    return {
      sheetName: worksheet.name,
      totalRows: 0,
      validRows: [],
      issues: [
        {
          message: `Missing required columns: ${missingColumns.join(", ")}.`,
        },
      ],
    };
  }

  const validRows: ScheduleImportRow[] = [];
  const issues: ScheduleImportIssue[] = [];
  const seenKeys = new Set<string>();
  let totalRows = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const raw = new Map<string, unknown>();
    for (const column of HEADER_COLUMNS) {
      const index = columnIndexes.get(normalizeHeader(column));
      raw.set(column, index ? cellValue(excelRow.getCell(index)) : undefined);
    }

    if ([...raw.values()].every((value) => textValue(value) === "")) {
      continue;
    }
    totalRows += 1;

    const candidate = {
      niche: textValue(raw.get("Niche")),
      executionDate: dateValue(raw.get("Execution_Date")),
      targetCountry: textValue(raw.get("Target_Country")),
      targetAudience: textValue(raw.get("Target_Audience")),
      language: textValue(raw.get("Language")),
      researchIdeasCount: countValue(raw.get("Research_Ideas_Count")),
      pinsToGenerate: countValue(raw.get("Pins_To_Generate")),
      destinationUrl: textValue(raw.get("Destination_URL")),
      status: canonicalStatus(textValue(raw.get("Status"))),
    };

    const parsed = scheduleRowSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          rowNumber,
          field: issue.path.join("."),
          message: issue.message,
        });
      }
      continue;
    }

    const normalized = {
      ...parsed.data,
      destinationUrl: normalizeUrl(parsed.data.destinationUrl),
    };
    const scheduleKey = createScheduleKey(normalized);
    if (seenKeys.has(scheduleKey)) {
      issues.push({
        rowNumber,
        field: "schedule",
        message: "This schedule duplicates an earlier row in the workbook.",
      });
      continue;
    }

    seenKeys.add(scheduleKey);
    validRows.push({ ...normalized, scheduleKey, sourceRow: rowNumber });
  }

  return {
    sheetName: worksheet.name,
    totalRows,
    validRows,
    issues,
  };
}
