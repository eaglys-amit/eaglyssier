import { Lock } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";

/** Shown in place of a page the signed-in user's role doesn't cover. */
export function NoAccess() {
  return (
    <div className="p-6">
      <EmptyState
        icon={Lock}
        title="Not available for your role"
        hint="Ask a project manager or an admin if you need access to this page."
      />
    </div>
  );
}
