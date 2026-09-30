"use client";

import type { ChannelGroups } from "@roster/api";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CommandBar } from "~/components/command-bar/command-bar";
import { ThreadSwitcher } from "~/components/command-bar/thread-switcher";
import { useShortcuts } from "~/hooks/use-shortcuts";
import {
  readHistory,
  recordVisit,
  writeHistory,
  type VisitedThread,
} from "~/utils/thread-history";

interface CommandContextValue {
  openCommandBar: () => void;
  enterThread: (entry: VisitedThread) => void;
  leaveThread: (threadId: string) => void;
}

const CommandContext = createContext<CommandContextValue | null>(null);

export function useCommands(): CommandContextValue {
  const value = useContext(CommandContext);
  if (!value) {
    throw new Error("useCommands must be used inside <CommandProvider>.");
  }
  return value;
}

export interface CommandProviderProps {
  orgSlug: string;
  channels: ChannelGroups;
  children: ReactNode;
}

export function CommandProvider({
  orgSlug,
  channels,
  children,
}: CommandProviderProps) {
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);

  const openCommandBar = useCallback(() => setCommandBarOpen(true), []);

  const enterThread = useCallback((entry: VisitedThread) => {
    writeHistory(recordVisit(readHistory(), entry));
    setCurrentThreadId(entry.threadId);
  }, []);

  const leaveThread = useCallback((threadId: string) => {
    setCurrentThreadId((current) => (current === threadId ? null : current));
  }, []);

  useShortcuts([
    {
      key: "$mod+k",
      preventDefault: true,
      handler: () => setCommandBarOpen((current) => !current),
    },
  ]);

  const value = useMemo(
    () => ({ openCommandBar, enterThread, leaveThread }),
    [openCommandBar, enterThread, leaveThread],
  );

  return (
    <CommandContext.Provider value={value}>
      {children}

      <CommandBar
        open={commandBarOpen}
        onOpenChange={setCommandBarOpen}
        orgSlug={orgSlug}
        channels={channels}
      />

      <ThreadSwitcher
        orgSlug={orgSlug}
        channels={channels}
        currentThreadId={currentThreadId}
      />
    </CommandContext.Provider>
  );
}
