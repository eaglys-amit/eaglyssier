/**
 * Handing the user a file or the clipboard, client-side.
 *
 * Everything else that downloads in this app links to a URL the server signed
 * (see DocumentsTab), but text we generate here has no server copy to point at,
 * so it goes out as a blob.
 */

/**
 * Hand `blob` to the user as `filename`.
 *
 * Shared with downloadText because the DOM dance is the fiddly part and both
 * halves of it are browser workarounds — Firefox and Safari each need one.
 * Used directly for a file the server built (the documentation-set .zip), which
 * arrives as a blob because it has to go through api.blob to surface errors.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Firefox only honours a click on a node that's in the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not immediate: Safari reads the href after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Save `text` as a file, without a round trip. */
export function downloadText(
  filename: string,
  text: string,
  mime = "text/markdown;charset=utf-8",
): void {
  saveBlob(new Blob([text], { type: mime }), filename);
}

/**
 * Put `text` on the clipboard, reporting whether it landed so the caller can say
 * so rather than silently doing nothing.
 *
 * `navigator.clipboard` is undefined outside a secure context, which this app
 * hits whenever it's served over plain HTTP on a LAN — the deprecated
 * execCommand path is the only thing that works there.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied permission, or a non-focused document. Fall through and try the
    // selection-based path, which asks for neither.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    // Off-screen rather than hidden: display:none and visibility:hidden can't be
    // selected, and a fixed position avoids scrolling the page to reach it.
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** A safe, readable filename stem: "Sprint 12 — Poker" → "sprint-12-poker". */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      // Everything was punctuation, or the name was empty.
      || "export"
  );
}
