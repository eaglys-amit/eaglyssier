import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, ApiError } from "@/lib/api";
import { qk } from "@/lib/query-keys";
import type { ReferenceFolder } from "@/types/api";

/**
 * The project's document folders, plus create / rename / move / delete.
 *
 * Every mutation invalidates the files list as well as the folders list: a
 * delete re-homes documents at the root (folder_id is SET NULL server-side), so
 * the table would otherwise keep showing them inside a folder that is gone.
 */
export function useReferenceFolders(projectId: number) {
  const qc = useQueryClient();
  const key = qk.referenceFolders(projectId);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: qk.referenceFiles(projectId) });
  };

  const folders = useQuery({
    queryKey: key,
    queryFn: () => api.get<ReferenceFolder[]>(`/projects/${projectId}/reference-folders`),
    enabled: Number.isFinite(projectId),
  });

  const create = useMutation({
    mutationFn: (input: { name: string; parentId: number | null }) =>
      api.post<ReferenceFolder>(`/projects/${projectId}/reference-folders`, {
        name: input.name,
        parent_id: input.parentId,
      }),
    onSuccess: (folder) => {
      invalidate();
      toast.success(`Created ${folder.name}`);
    },
    // The server owns the rules worth surfacing verbatim — a duplicate sibling
    // name comes back naming the folder that already exists.
    onError: (err: ApiError) => toast.error(err.detail || "Could not create the folder"),
  });

  const rename = useMutation({
    mutationFn: (input: { folderId: number; name: string }) =>
      api.patch<ReferenceFolder>(
        `/projects/${projectId}/reference-folders/${input.folderId}`,
        { name: input.name },
      ),
    onSuccess: invalidate,
    onError: (err: ApiError) => toast.error(err.detail || "Could not rename the folder"),
  });

  const move = useMutation({
    // parent_id is sent explicitly, including as null: the server reads an
    // absent field as "leave the parent alone", so omitting it would make
    // "move to the top level" a no-op.
    mutationFn: (input: { folderId: number; parentId: number | null }) =>
      api.patch<ReferenceFolder>(
        `/projects/${projectId}/reference-folders/${input.folderId}`,
        { parent_id: input.parentId },
      ),
    onSuccess: invalidate,
    onError: (err: ApiError) => toast.error(err.detail || "Could not move the folder"),
  });

  const remove = useMutation({
    mutationFn: (folderId: number) =>
      api.delete(`/projects/${projectId}/reference-folders/${folderId}`),
    onSuccess: () => {
      invalidate();
      toast.success("Folder deleted");
    },
    onError: (err: ApiError) => toast.error(err.detail || "Could not delete the folder"),
  });

  return {
    folders: folders.data,
    isPending: folders.isPending,
    create,
    rename,
    move,
    remove,
  };
}
