/** Client-side upload rules. The server enforces the same limits — this just
 *  saves a round trip and gives an instant reason. */

/** Must match settings.reference_max_bytes. */
export const MAX_BYTES = 10_000_000;

/** The `accept` attribute for the file input. */
export const ACCEPT = ".md,.markdown,.txt,.text,.html,.htm,.pdf,.pptx";

// Extension, not MIME: browsers report .md as text/markdown, text/plain, or
// nothing at all depending on the OS, so the type is only a hint.
const EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "html",
  "htm",
  "pdf",
  "pptx",
]);

export function validateFiles(files: File[]): {
  accepted: File[];
  rejected: { file: File; reason: string }[];
} {
  const accepted: File[] = [];
  const rejected: { file: File; reason: string }[] = [];

  for (const file of files) {
    const ext = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : "";
    if (!EXTENSIONS.has(ext)) {
      rejected.push({ file, reason: "only Markdown, text, HTML, PDF and PowerPoint are supported" });
    } else if (file.size === 0) {
      rejected.push({ file, reason: "the file is empty" });
    } else if (file.size > MAX_BYTES) {
      rejected.push({ file, reason: `larger than the ${MAX_BYTES / 1_000_000} MB limit` });
    } else {
      accepted.push(file);
    }
  }
  return { accepted, rejected };
}
