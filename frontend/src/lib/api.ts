export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
  parse?: (res: Response) => Promise<T>,
): Promise<T> {
  // FormData has to set its own multipart boundary, so the JSON content-type is
  // only defaulted for JSON payloads — forcing it would corrupt the body.
  //
  // `...init` also has to come first: spreading it last replaced `headers`
  // wholesale for any caller that passed its own, silently dropping the
  // content-type. Nobody did yet, but the ordering was a trap.
  const isForm = init?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(isForm ? null : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (body?.detail) detail = JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return parse ? parse(res) : (res.json() as Promise<T>);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  /**
   * Multipart POST. The browser sets Content-Type so it can add the boundary;
   * the response is JSON like every other verb.
   *
   * No progress reporting: `fetch` can't report upload progress at all. For
   * capped reference documents an indeterminate state is enough, and it matches
   * the rest of the app, which has no progress bars. A real bar would need a
   * separate XHR export rather than a change here.
   */
  upload: <T>(path: string, form: FormData) =>
    request<T>(path, { method: "POST", body: form }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T = void>(path: string) => request<T>(path, { method: "DELETE" }),
  /**
   * A file the server builds on the fly — today the documentation-set .zip.
   *
   * Through `request` rather than an <a href download> so a failure surfaces as
   * an ApiError with the server's detail and a toast, instead of navigating the
   * user to a page of raw JSON. Anything the server has already stored (see
   * ReferenceFile.download_url) stays a plain anchor: it can't fail this way.
   */
  blob: (path: string) => request<Blob>(path, {}, (res) => res.blob()),
};
