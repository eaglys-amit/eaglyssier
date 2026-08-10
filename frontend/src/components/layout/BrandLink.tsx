import { Link } from "react-router-dom";

import dossierMark from "@/assets/eaglyssier-mark.png";

/**
 * The product mark, and the way back to the front door. It sits at the far left
 * of the header on the workspace pages — the ones that carry no sidebar to
 * brand them.
 */
export function BrandLink() {
  return (
    <Link
      to="/"
      className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight transition-opacity hover:opacity-80"
    >
      <img src={dossierMark} alt="" className="size-8 shrink-0" />
      Eaglyssier
    </Link>
  );
}
