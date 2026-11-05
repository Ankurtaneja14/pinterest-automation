"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload } from "lucide-react";
import { z } from "zod";

const previewResponseSchema = z.object({
  sheetName: z.string().nullable(),
  totalRows: z.number().int().nonnegative(),
  validRows: z.array(
    z.object({
      niche: z.string(),
      executionDate: z.string(),
      targetCountry: z.string(),
      targetAudience: z.string(),
      researchIdeasCount: z.number(),
      pinsToGenerate: z.number(),
      scheduleKey: z.string(),
      existingStatus: z.string().nullable(),
    }),
  ),
  issues: z.array(
    z.object({
      rowNumber: z.number().optional(),
      field: z.string().optional(),
      message: z.string(),
    }),
  ),
});

const importResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

type PreviewResponse = z.infer<typeof previewResponseSchema>;

export function ScheduleImporter() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function previewWorkbook() {
    if (!file) {
      setError("Choose an .xlsx workbook first.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    setPreview(null);
    try {
      const form = new FormData();
      form.set("workbook", file);
      const response = await fetch("/api/schedules/preview", {
        method: "POST",
        body: form,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Could not preview this workbook.";
        throw new Error(message);
      }
      const validatedPreview = previewResponseSchema.safeParse(payload);
      if (!validatedPreview.success) {
        throw new Error("The server returned an invalid preview response.");
      }
      setPreview(validatedPreview.data);
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Could not preview this workbook.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function importWorkbook() {
    if (!file || !preview || preview.issues.length > 0) {
      setError("Preview a valid workbook before importing it.");
      return;
    }
    if (preview.validRows.length === 0) {
      setError("There are no valid schedule rows to import.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.set("workbook", file);
      const response = await fetch("/api/schedules/import", {
        method: "POST",
        body: form,
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Could not import this workbook.";
        throw new Error(message);
      }
      const validatedImport = importResponseSchema.safeParse(payload);
      if (!validatedImport.success) {
        throw new Error("The server returned an invalid import response.");
      }

      setSuccess(
        `Imported ${validatedImport.data.imported}, updated ${validatedImport.data.updated}, and skipped ${validatedImport.data.skipped} existing schedules.`,
      );
      setFile(null);
      setPreview(null);
      router.refresh();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : "Could not import this workbook.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel importer-panel" aria-labelledby="import-title">
      <div className="panel-heading">
        <div>
          <h2 id="import-title">Import an Excel schedule</h2>
          <p>
            Upload a workbook with a <code>Niche_Schedule</code> worksheet to
            preview and validate its rows.
          </p>
        </div>
        <span className="metric-icon">
          <FileSpreadsheet size={17} />
        </span>
      </div>

      <div className="import-controls">
        <label className="file-picker" htmlFor="schedule-workbook">
          <Upload size={16} />
          <span>{file ? file.name : "Choose .xlsx workbook"}</span>
          <input
            id="schedule-workbook"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0] ?? null);
              setPreview(null);
              setError(null);
              setSuccess(null);
            }}
          />
        </label>
        <button
          className="primary-button"
          type="button"
          onClick={previewWorkbook}
          disabled={busy || !file}
        >
          {busy ? "Working…" : "Preview workbook"}
        </button>
      </div>

      <p className="import-hint">
        Required columns: Niche, Execution_Date, Target_Country,
        Target_Audience, Language, Research_Ideas_Count, Pins_To_Generate, and
        Destination_URL. Status is optional.
      </p>

      {error && (
        <p className="feedback-message feedback-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="feedback-message feedback-success" role="status">
          {success}
        </p>
      )}

      {preview && (
        <div className="preview-section">
          <div className="preview-summary">
            <div>
              <strong>{preview.sheetName ?? "Workbook"}</strong>
              <span>
                {preview.validRows.length} valid of {preview.totalRows} non-empty
                rows
              </span>
            </div>
            {preview.issues.length === 0 && preview.validRows.length > 0 && (
              <button
                className="primary-button"
                type="button"
                onClick={importWorkbook}
                disabled={busy}
              >
                Import validated schedules
              </button>
            )}
          </div>

          {preview.issues.length > 0 && (
            <ul className="validation-issues" aria-label="Workbook validation errors">
              {preview.issues.map((issue, index) => (
                <li key={`${issue.rowNumber ?? "workbook"}-${issue.field ?? index}-${index}`}>
                  {issue.rowNumber ? `Row ${issue.rowNumber}: ` : ""}
                  {issue.field ? `${issue.field} — ` : ""}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}

          {preview.validRows.length > 0 && (
            <div className="table-scroll preview-table">
              <table>
                <thead>
                  <tr>
                    <th>Niche</th>
                    <th>Execution date</th>
                    <th>Country</th>
                    <th>Audience</th>
                    <th>Ideas</th>
                    <th>Pins</th>
                    <th>Import state</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.validRows.map((row) => (
                    <tr key={row.scheduleKey}>
                      <td>{row.niche}</td>
                      <td>{row.executionDate}</td>
                      <td>{row.targetCountry}</td>
                      <td>{row.targetAudience}</td>
                      <td>{row.researchIdeasCount}</td>
                      <td>{row.pinsToGenerate}</td>
                      <td>
                        {row.existingStatus
                          ? `Already stored · ${row.existingStatus}`
                          : "New schedule"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
