export const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

export async function readWorkbookUpload(request: Request): Promise<Buffer> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new Error("Request must contain a multipart .xlsx workbook.");
  }
  const upload = form.get("workbook");

  if (!(upload instanceof File)) {
    throw new Error('Choose an .xlsx workbook in the "workbook" field.');
  }
  if (!upload.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Only .xlsx workbooks are supported.");
  }
  if (upload.size === 0) {
    throw new Error("The selected workbook is empty.");
  }
  if (upload.size > MAX_WORKBOOK_BYTES) {
    throw new Error("Workbook must be 10 MB or smaller.");
  }

  const buffer = Buffer.from(await upload.arrayBuffer());
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("The selected file is not a valid .xlsx workbook.");
  }
  return buffer;
}
