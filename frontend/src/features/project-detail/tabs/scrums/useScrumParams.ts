import { useViewParams } from "../useViewParams";

import { DEFAULT_SCRUM_VIEW, isScrumView } from "./scrum-nav";

/**
 * The Scrums & Epics tab's UI state, in the URL. The implementation is shared
 * with Sprint Planning — see useViewParams — so `?sprint=` means the same thing
 * on both and survives moving between them.
 */
export function useScrumParams() {
  return useViewParams(isScrumView, DEFAULT_SCRUM_VIEW);
}
