import type { ReactNode } from "react";

import { MentionPopover } from "~/components/messages/mention-popover";
import { UserRealtime } from "~/components/notifications/user-realtime";
import { CommandProvider } from "~/components/providers/command-provider";
import { AppSidebar } from "~/components/sidebar/app-sidebar";
import type { Shell } from "~/lib/shell";
import type { SidebarSection } from "~/types";

import { PageHeader } from "./page-header";
import { RailLayout, type RailLayoutOptions } from "./rail-layout";
import { SidebarSheet } from "./sidebar-sheet";

export interface AppShellProps {
  shell: Shell;
  section: SidebarSection;
  activeChannelSlug?: string;
  title: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
  flush?: boolean;
  rail?: ReactNode;
  railLayout?: RailLayoutOptions;
  children: ReactNode;
}

export function AppShell({
  shell,
  section,
  activeChannelSlug,
  title,
  actions,
  tabs,
  flush,
  rail,
  railLayout,
  children,
}: AppShellProps) {
  const sidebar = (
    <AppSidebar
      shell={shell}
      section={section}
      activeChannelSlug={activeChannelSlug}
    />
  );

  const column = (
    <div className="flex min-w-0 flex-1 flex-col">
      <PageHeader
        title={title}
        actions={actions}
        tabs={tabs}
        nav={<SidebarSheet>{sidebar}</SidebarSheet>}
      />
      {flush ? (
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      ) : (
        <div className="overscroll-contain flex-1 overflow-y-auto">
          <div className="pb-safe-2 flex w-full max-w-3xl flex-col gap-6 p-3 sm:p-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <CommandProvider
      orgSlug={shell.organization.slug}
      channels={shell.channels}
    >
      <div className="bg-background px-safe flex h-full">
        <div className="hidden md:flex">{sidebar}</div>

        <main className="bg-background-2 shadow-1 flex min-w-0 flex-1 overflow-hidden md:mr-2 md:mt-2 md:rounded-xl">
          <RailLayout main={column} rail={rail} options={railLayout} />
        </main>

        <MentionPopover />
        <UserRealtime />
      </div>
    </CommandProvider>
  );
}
