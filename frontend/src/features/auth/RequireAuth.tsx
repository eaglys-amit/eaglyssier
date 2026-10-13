import { Navigate, Outlet, useLocation } from "react-router-dom";

import { ApiError } from "@/lib/api";
import { useMe } from "@/lib/permissions";

/** Layout route: renders the app once /auth/me confirms a session, else sends to /login. */
export function RequireAuth() {
  const location = useLocation();
  const { data: me, error, isPending } = useMe();

  if (isPending) return null;
  if (!me) {
    if (error instanceof ApiError && error.status !== 401) {
      return (
        <p className="p-6 text-sm text-destructive">Could not reach the server: {error.detail}</p>
      );
    }
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <Outlet />;
}
