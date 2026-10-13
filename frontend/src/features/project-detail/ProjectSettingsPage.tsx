import { PageHeader } from "@/components/layout/PageHeader";
import { NoAccess } from "@/components/shared/NoAccess";
import { useAccess } from "@/lib/permissions";

import { useProject } from "@/features/project-detail/ProjectShell";
import {
  PROJECT_SETTINGS,
  settingsCap,
  type SettingsSection,
} from "@/features/project-detail/settings-nav";
import { ActivityTab } from "@/features/project-detail/tabs/ActivityTab";
import { IntegrationsTab } from "@/features/project-detail/tabs/IntegrationsTab";
import { ProjectMembersTab } from "@/features/project-detail/tabs/ProjectMembersTab";
import { ProviderTab } from "@/features/project-detail/tabs/ProviderTab";

/**
 * One project setup section — provider, integrations, members, or activity.
 * Each is a sidebar destination rather than an analysis tab, so the tab strip
 * steps aside and the section gets the whole content column.
 */
export function ProjectSettingsPage({ section }: { section: SettingsSection }) {
  const { projectId, project } = useProject();
  const current = PROJECT_SETTINGS.find((s) => s.key === section)!;
  const access = useAccess(projectId);

  return (
    <>
      <PageHeader
        sticky={false}
        icon={current.icon}
        title={current.label}
        description={current.blurb}
      />
      <div className="p-6">
        {!access.can(settingsCap(section)) ? <NoAccess /> : <>
        {section === "provider" && <ProviderTab projectId={projectId} project={project} />}
        {section === "integrations" && <IntegrationsTab projectId={projectId} />}
        {section === "members" && <ProjectMembersTab projectId={projectId} />}
        {section === "activity" && <ActivityTab projectId={projectId} />}
        </>}
      </div>
    </>
  );
}
