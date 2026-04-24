import Anthropic from "@anthropic-ai/sdk";

/**
 * Anthropic Files API helper used only as a fallback for PDFs too
 * large to inline as base64 (>~24 MB raw, which expands to >32 MB
 * base64 — the hard ceiling on the inline `source.type = "base64"`
 * path).
 *
 * Status: beta. Every call requires the `anthropic-beta:
 * files-api-2025-04-14` header, passed through the SDK via the
 * `betas: [...]` field on `beta.messages.create` / `beta.files.*`.
 *
 * Billing: uploads / deletes / metadata lookups are free. Only the
 * Messages request that *references* the file_id is billed, and it's
 * billed identically to the equivalent inline-PDF request (input
 * tokens per page).
 *
 * Lifecycle: uploaded files persist indefinitely until explicitly
 * deleted. Callers MUST delete after classification (try/finally).
 */

export const FILES_API_BETA = "files-api-2025-04-14";

// Threshold for routing a PDF through the Files API. Base64 encoding
// expands binary by ~4/3 so a 24 MB raw PDF becomes ~32 MB base64 —
// the documented inline request ceiling. 24 MB leaves a little
// headroom for request JSON framing.
export const FILES_API_THRESHOLD_BYTES = 24 * 1024 * 1024;

export type UploadedFile = {
  fileId: string;
  uploadMs: number;
  sizeBytes: number;
};

/**
 * Upload a PDF to Anthropic Files storage. Returns the file_id the
 * caller should pass in a `document` content block with
 * `source.type = "file"`. Thin wrapper over
 * `client.beta.files.upload` — exposes timing for observability.
 */
export async function uploadPdfToFilesApi(
  bytes: Uint8Array,
  filename: string,
): Promise<UploadedFile> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });

  const t0 = Date.now();
  // Node 20+ exposes a web-standard `File` globally; SDK accepts any
  // BlobLike (Uint8Array slice → Blob → File). We copy into a fresh
  // Uint8Array so pdfjs doesn't see a detached ArrayBuffer later.
  const copied = new Uint8Array(bytes);
  const file = new File([copied], filename, { type: "application/pdf" });
  // `client.beta.files.*` applies the Files-API beta header
  // automatically — no need to pass it through RequestOptions.
  const uploaded = await client.beta.files.upload({ file });
  return {
    fileId: uploaded.id,
    uploadMs: Date.now() - t0,
    sizeBytes: bytes.length,
  };
}

/**
 * Delete an uploaded file. Callers should invoke this in a `finally`
 * block so a classification crash doesn't leak storage. Throws on
 * 404 / 403 — callers who just want best-effort cleanup should wrap
 * in a try/catch.
 */
export async function deleteFileFromFilesApi(
  fileId: string,
): Promise<{ deleteMs: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("missing ANTHROPIC_API_KEY");
  const client = new Anthropic({ apiKey });

  const t0 = Date.now();
  await client.beta.files.delete(fileId);
  return { deleteMs: Date.now() - t0 };
}
