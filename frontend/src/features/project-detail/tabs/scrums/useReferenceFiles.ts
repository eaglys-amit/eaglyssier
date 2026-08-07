import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ReferenceFile, ReferenceUpload } from "@/types/api";

/** The project's reference documents, plus upload / delete / re-extract. */
export function useReferenceFiles(projectId: number) {
  const qc = useQueryClient();
  const key = qk.referenceFiles(projectId);

  const files = useQuery({
    queryKey: key,
    queryFn: () => api.get<ReferenceFile[]>(`/projects/${projectId}/references`),
    enabled: Number.isFinite(projectId),
  });

  const upload = useMutation({
    mutationFn: (chosen: File[]) => {
      const form = new FormData();
      for (const file of chosen) form.append("files", file);
      return api.upload<ReferenceUpload>(`/projects/${projectId}/references`, form);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: key });
      // Server-side rejections surface individually: a batch can be part
      // success, and saying "3 uploaded" while quietly dropping two would be a
      // lie the user only discovers later.
      for (const r of result.rejected) toast.error(`${r.filename} — ${r.reason}`);
      if (result.uploaded.length) {
        const n = result.uploaded.length;
        toast.success(`Uploaded ${n} ${n === 1 ? "document" : "documents"}`);
      }
      const empty = result.uploaded.filter(
        (f) => f.extract_status === "ready" && f.char_count === 0,
      );
      for (const f of empty) {
        toast.warning(
          `${f.filename} holds no extractable text — it's stored, but it can't inform an AI breakdown.`,
        );
      }
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not upload"),
  });

  const remove = useMutation({
    mutationFn: (fileId: number) => api.delete(`/references/${fileId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete the document"),
  });

  const reExtract = useMutation({
    mutationFn: (fileId: number) => api.post<ReferenceFile>(`/references/${fileId}/extract`),
    onSuccess: (file) => {
      qc.invalidateQueries({ queryKey: key });
      if (file.extract_status === "ready" && file.char_count > 0) {
        toast.success(`Extracted ${file.char_count.toLocaleString()} characters`);
      } else if (file.extract_status === "ready") {
        toast.warning("Still no extractable text — the file has no text layer.");
      }
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not re-read the document"),
  });

  return { files: files.data, isPending: files.isPending, upload, remove, reExtract };
}
