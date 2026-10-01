"use client";
import { useParams } from "next/navigation";
import { useApi } from "@/lib/api";
import { AppForm, type App } from "@/components/AppForm";
import { PageHeader, Skeleton } from "@/components/ui";

type Detail = { app: App & { method: string; expectedStatus: number; timeoutMs: number; insecureTls: boolean } };

export default function EditAppPage() {
  const { id } = useParams<{ id: string }>();
  // No auto-refresh: a background reload would reset fields while the user is typing.
  const { data, error } = useApi<Detail>(`/apps/${id}?range=1h`, 0);

  return (
    <div className="stack">
      <PageHeader back={`/apps/${id}`} backLabel={data?.app.name ?? "Back"} title="Edit application" subtitle="Changes apply from the next check cycle." />
      {error ? <div className="alert">{error}</div> : !data ? <div className="card form-card"><Skeleton h={320} /></div> : <AppForm initial={data.app} cancelHref={`/apps/${id}`} />}
    </div>
  );
}
