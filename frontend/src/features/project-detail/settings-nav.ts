import { History, Plug, Sparkles, Users, type LucideIcon } from "lucide-react";

import type { Cap } from "@/lib/permissions";

/**
 * Project setup destinations. Shared by the title-bar links on the project page
 * and the nav inside the settings pages themselves, so the two can't drift.
 */
export const PROJECT_SETTINGS = [
  {
    key: "provider",
    label: "Provider",
    icon: Sparkles,
    blurb: "The LLM account this project uses for summaries, analyses, and reports.",
    cap: "admin",
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: Plug,
    blurb: "Platforms this project pulls data from. Tokens are encrypted at rest.",
    cap: "admin",
  },
  {
    key: "members",
    label: "Members",
    icon: Users,
    blurb: "Who is on this project, and which synced accounts map to them.",
  },
  {
    key: "activity",
    label: "Activity",
    icon: History,
    blurb: "Recent sync runs across every connected platform.",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  icon: LucideIcon;
  blurb: string;
  /** Capability needed to open the section (default: "view"). */
  cap?: Cap;
}>;

export type SettingsSection = (typeof PROJECT_SETTINGS)[number]["key"];

export function settingsCap(key: SettingsSection): Cap {
  const section = PROJECT_SETTINGS.find((s) => s.key === key);
  return section && "cap" in section ? section.cap : "view";
}
