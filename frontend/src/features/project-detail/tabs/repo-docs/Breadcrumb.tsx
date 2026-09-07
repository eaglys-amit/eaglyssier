import { FileText, FolderGit2 } from "lucide-react";

import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { cn } from "@/lib/utils";
import type { RepoDoc, RepoDocFolder } from "@/types/api";

/**
 * Repository → folder… → document.
 *
 * A copy of the Documents tab's private breadcrumb rather than an export of it:
 * the leading crumb is a repository (with its platform icon) instead of "All
 * documents", and the terminal crumb is a document rather than a folder. Both
 * ends differ, so exporting a component between sibling tabs would buy a shared
 * shell and two sets of conditionals.
 */
export function Breadcrumb({
  repoName,
  provider,
  path,
  doc,
  onRoot,
  onFolder,
}: {
  repoName: string;
  provider?: string | null;
  path: RepoDocFolder[];
  doc?: RepoDoc | null;
  onRoot: () => void;
  onFolder: (folderId: number) => void;
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs"
    >
      <button type="button" onClick={onRoot} className={cn(CRUMB, "shrink-0")}>
        {provider ? (
          <PlatformIcon platform={provider} size={12} />
        ) : (
          <FolderGit2 className="size-3" />
        )}
        <span className="max-w-[14rem] truncate">{repoName}</span>
      </button>

      {path.map((folder) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-1">
          <span className="shrink-0">/</span>
          <button
            type="button"
            onClick={() => onFolder(folder.id)}
            className={cn(CRUMB, "min-w-0")}
          >
            <span className="truncate">{folder.name}</span>
          </button>
        </span>
      ))}

      {doc ? (
        <span className="flex min-w-0 items-center gap-1">
          <span className="shrink-0">/</span>
          <span className="text-foreground flex min-w-0 items-center gap-1 font-medium">
            <FileText className="size-3 shrink-0" />
            <span className="truncate">{doc.title}</span>
          </span>
        </span>
      ) : null}
    </nav>
  );
}

const CRUMB =
  "flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground";
