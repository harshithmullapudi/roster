import { loadOnboardingState, resolveStep } from "@roster/api";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { DockProvider } from "~/components/terminals/dock-provider";
import { DockStatusBar } from "~/components/terminals/dock-status-bar";
import { TerminalDock } from "~/components/terminals/terminal-dock";
import { requireOrg } from "~/lib/session";

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { session, organization } = await requireOrg(slug);

  const state = await loadOnboardingState({
    userId: session.user.id,
    email: session.user.email,
    organizationId: organization.id,
  });
  if (resolveStep(state) !== "done") redirect("/onboarding");

  return (
    <DockProvider>
      <div className="bg-background flex h-dvh flex-col">
        <div className="min-h-0 flex-1">{children}</div>
        <TerminalDock />
        <DockStatusBar orgSlug={organization.slug} />
      </div>
    </DockProvider>
  );
}
