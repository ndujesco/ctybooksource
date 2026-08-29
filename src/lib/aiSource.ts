/* ---------------------------------------------------------------------------
   Reading a request body into content blocks for the Anthropic API.

   Shared by every AI endpoint that accepts "a photo, a PDF, or pasted text" —
   currently order extraction and catalogue extraction. Keeping the file
   parsing in one place means both endpoints support the same file types the
   same way.
   ------------------------------------------------------------------------ */

export type ImageMedia = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
export type Source =
  | { kind: "text"; text: string }
  | { kind: "pdf"; base64: string }
  | { kind: "image"; base64: string; media: ImageMedia };

export class SourceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function imageMedia(name: string, type: string): ImageMedia {
  if (type === "image/png" || name.endsWith(".png")) return "image/png";
  if (type === "image/webp" || name.endsWith(".webp")) return "image/webp";
  if (type === "image/gif" || name.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

/** Pull sources out of a JSON `{ text }` body or a multipart form (files + text). */
export async function readSources(req: Request, maxBytes: number): Promise<Source[]> {
  const sources: Source[] = [];
  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const text = String((body as { text?: unknown })?.text ?? "").trim();
      if (text) sources.push({ kind: "text", text });
      return sources;
    }

    const form = await req.formData();
    const files = form.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
    const text = form.get("text");

    let total = 0;
    for (const file of files) {
      total += file.size;
      if (total > maxBytes) {
        throw new SourceError(
          `Those files are too large together (max ${Math.round(maxBytes / (1024 * 1024))}MB).`,
          413
        );
      }
      const name = file.name.toLowerCase();
      const buf = Buffer.from(await file.arrayBuffer());
      const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(name);

      if (name.endsWith(".pdf") || file.type === "application/pdf") {
        sources.push({ kind: "pdf", base64: buf.toString("base64") });
      } else if (isImage) {
        sources.push({ kind: "image", base64: buf.toString("base64"), media: imageMedia(name, file.type) });
      } else if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth");
        const { value } = await mammoth.extractRawText({ buffer: buf });
        if (value.trim()) sources.push({ kind: "text", text: value.trim() });
      } else {
        const plain = buf.toString("utf-8").trim();
        if (plain) sources.push({ kind: "text", text: plain });
      }
    }

    if (typeof text === "string" && text.trim()) {
      sources.push({ kind: "text", text: text.trim() });
    }
    return sources;
  } catch (err) {
    if (err instanceof SourceError) throw err;
    throw new SourceError("Couldn't read that input.");
  }
}
