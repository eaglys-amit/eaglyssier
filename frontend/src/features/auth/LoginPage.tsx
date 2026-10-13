import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import dossierMark from "@/assets/eaglyssier-mark.png";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/permissions";
import { qk } from "@/lib/query-keys";
import type { Me } from "@/types/api";

/** Only same-app paths, so ?next= can't bounce a fresh login to another site. */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      api.post<Me>("/auth/login", body),
    onSuccess: (user) => {
      // Anything cached belonged to whoever was signed in before.
      qc.clear();
      qc.setQueryData(qk.me, user);
      navigate(next, { replace: true });
    },
    onError: (err: ApiError) => setError(err.detail || "Could not sign in"),
  });

  if (me) return <Navigate to={next} replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <img src={dossierMark} alt="" className="size-12" />
            <h1 className="text-lg font-semibold tracking-tight">Sign in to Eaglyssier</h1>
          </div>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const fd = new FormData(e.currentTarget);
              login.mutate({
                email: String(fd.get("email") ?? ""),
                password: String(fd.get("password") ?? ""),
              });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
