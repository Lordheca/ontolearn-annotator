"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * App-wide error boundary (Next.js App Router convention).
 *
 * This is what a user now sees, instead of a bare framework error page, when
 * a Server Component throws — most notably when the ABAC service is
 * unreachable and `checkPermission` (src/lib/abac-client.ts) throws
 * AbacUnreachableError instead of silently resolving to `false`. Several
 * call sites (fetchProject, fetchProjectsAndCategoriesByUser, the project
 * header, and the settings/data pages) call checkPermission directly with no
 * try/catch, so on an ABAC outage this boundary is what catches it.
 *
 * Note: Next.js redacts error details in production before they reach a
 * client component like this one (only a `digest` for server-log
 * correlation survives), so we intentionally show one generic message here
 * rather than trying to special-case AbacUnreachableError — that
 * distinction is preserved server-side in logs and in the API routes that
 * do their own try/catch, not in this boundary.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Errors");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <AlertTriangle className="h-10 w-10 text-muted-foreground" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {t("description")}
        </p>
      </div>
      <Button onClick={() => reset()}>{t("retry")}</Button>
    </div>
  );
}