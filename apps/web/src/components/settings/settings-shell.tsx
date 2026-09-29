"use client";

import { Button, cn } from "@roster/ui";
import {
  Bot,
  ChevronLeft,
  KeyRound,
  Server,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface SettingsShellProps {
  orgSlug: string;
  children: ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

function groupsFor(orgSlug: string): NavGroup[] {
  const base = `/${orgSlug}/settings`;

  return [
    {
      title: "Personal",
      items: [
        {
          href: `${base}/preferences`,
          label: "Preferences",
          icon: <SlidersHorizontal size={14} />,
        },
      ],
    },
    {
      title: "Team",
      items: [
        { href: `${base}/members`, label: "Members", icon: <Users size={14} /> },
        { href: `${base}/agents`, label: "Agents", icon: <Bot size={14} /> },
        { href: `${base}/keys`, label: "API keys", icon: <KeyRound size={14} /> },
      ],
    },
    {
      title: "Workspace",
      items: [
        {
          href: `${base}/hosts`,
          label: "Hosts & folders",
          icon: <Server size={14} />,
        },
      ],
    },
  ];
}

export function SettingsShell({ orgSlug, children }: SettingsShellProps) {
  const pathname = usePathname();
  const groups = groupsFor(orgSlug);

  return (
    <div className="bg-background px-safe flex h-dvh">
      <aside className="hidden h-full w-56 shrink-0 flex-col gap-4 p-2 md:flex">
        <Button
          variant="ghost"
          full
          className="text-muted-foreground min-w-0 justify-start gap-1.5 !rounded-md px-1.5"
          asChild
        >
          <Link href={`/${orgSlug}`}>
            <ChevronLeft size={14} />
            <span className="truncate">Back to app</span>
          </Link>
        </Button>

        <nav className="overscroll-contain flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.title} className="flex w-full min-w-0 flex-col gap-0.5">
              <p className="text-muted-foreground px-2 pb-1 text-xs">
                {group.title}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={pathname === item.href}
                />
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="bg-background-2 shadow-1 flex min-w-0 flex-1 flex-col overflow-hidden md:m-2 md:ml-0 md:rounded-xl">
        <div className="border-border flex items-center gap-1 overflow-x-auto border-b px-2 py-1.5 md:hidden">
          <Button
            variant="ghost"
            className="text-muted-foreground shrink-0 gap-1 !rounded-md"
            asChild
          >
            <Link href={`/${orgSlug}`}>
              <ChevronLeft size={14} />
              Back
            </Link>
          </Button>
          {groups
            .flatMap((group) => group.items)
            .map((item) => (
              <Button
                key={item.href}
                variant="ghost"
                isActive={pathname === item.href}
                className={cn(
                  "shrink-0 !rounded-md",
                  pathname === item.href && "!bg-accent !text-accent-foreground",
                )}
                asChild
              >
                <Link href={item.href}>{item.label}</Link>
              </Button>
            ))}
        </div>

        <div className="overscroll-contain flex-1 overflow-y-auto">
          <div className="pb-safe-2 mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Button
      variant="ghost"
      isActive={active}
      full
      className={cn(
        "text-foreground min-w-0 justify-start gap-2 !rounded-md px-2 text-sm select-none",
        active && "!bg-accent !text-accent-foreground",
      )}
      asChild
    >
      <Link href={item.href}>
        <span className="text-muted-foreground flex size-[14px] shrink-0 items-center justify-center">
          {item.icon}
        </span>
        <span className="min-w-0 truncate text-left">{item.label}</span>
      </Link>
    </Button>
  );
}
