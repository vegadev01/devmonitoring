"use client";
import { AppForm } from "@/components/AppForm";
import { PageHeader } from "@/components/ui";

export default function NewAppPage() {
  return (
    <div className="stack">
      <PageHeader back="/apps" backLabel="Applications" title="Add application" subtitle="DevMonitor will probe this URL on every check cycle." />
      <AppForm cancelHref="/apps" />
    </div>
  );
}
