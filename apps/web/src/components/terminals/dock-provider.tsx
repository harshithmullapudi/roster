"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DockMode = "closed" | "open";

export interface DockFolder {
  channelSlug: string;
  projectId: string;
}

interface DockSelection {
  workspaceId: string;
  terminalId: string | null;
}

interface DockValue {
  orgSlug: string;

  channel: DockFolder | null;
  setChannel: (channel: DockFolder | null) => void;

  folder: DockFolder | null;
  pickFolder: (folder: DockFolder) => void;

  mode: DockMode;
  setMode: (mode: DockMode) => void;
  toggle: () => void;

  selection: DockSelection | null;
  select: (selection: DockSelection) => void;

  height: number;
  setHeight: (height: number) => void;
}

const DockContext = createContext<DockValue | null>(null);

const HEIGHT_KEY = "roster:dock-height";
const MIN_HEIGHT = 160;
const DEFAULT_HEIGHT = 320;

export function DockProvider({
  orgSlug,
  children,
}: {
  orgSlug: string;
  children: ReactNode;
}) {
  const [channel, setChannelState] = useState<DockFolder | null>(null);
  const [picked, setPicked] = useState<DockFolder | null>(null);
  const [mode, setMode] = useState<DockMode>("closed");
  const [height, setHeightState] = useState(DEFAULT_HEIGHT);
  const [selections, setSelections] = useState<Record<string, DockSelection>>({});

  useEffect(() => {
    const stored = window.localStorage.getItem(HEIGHT_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : Number.NaN;
    if (Number.isFinite(parsed) && parsed >= MIN_HEIGHT) setHeightState(parsed);
  }, []);

  const setHeight = useCallback((next: number) => {
    const clamped = Math.max(MIN_HEIGHT, Math.round(next));
    setHeightState(clamped);
    window.localStorage.setItem(HEIGHT_KEY, String(clamped));
  }, []);

  /*
   * The page's channel presets the folder; leaving the page hands the folder
   * off to a manual pick so the dock keeps its context on Threads and Tasks.
   */
  const channelRef = useRef<DockFolder | null>(null);
  const setChannel = useCallback((next: DockFolder | null) => {
    setPicked(next ? null : channelRef.current);
    channelRef.current = next;
    setChannelState(next);
  }, []);

  const folder = channel && !picked ? channel : picked;

  const pickFolder = useCallback((next: DockFolder) => {
    setPicked(next);
  }, []);

  const select = useCallback(
    (selection: DockSelection) => {
      if (!folder) return;
      setSelections((current) => ({ ...current, [folder.projectId]: selection }));
    },
    [folder],
  );

  const toggle = useCallback(() => {
    setMode((current) => (current === "closed" ? "open" : "closed"));
  }, []);

  const value = useMemo<DockValue>(
    () => ({
      orgSlug,
      channel,
      setChannel,
      folder,
      pickFolder,
      mode,
      setMode,
      toggle,
      selection: folder ? (selections[folder.projectId] ?? null) : null,
      select,
      height,
      setHeight,
    }),
    [
      orgSlug,
      channel,
      setChannel,
      folder,
      pickFolder,
      mode,
      toggle,
      selections,
      select,
      height,
      setHeight,
    ],
  );

  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useDock(): DockValue {
  const value = useContext(DockContext);
  if (!value) throw new Error("useDock must be used inside a DockProvider");
  return value;
}

export function DockChannelBinding(props: DockFolder) {
  const { setChannel } = useDock();
  const { channelSlug, projectId } = props;

  useEffect(() => {
    setChannel({ channelSlug, projectId });
    return () => setChannel(null);
  }, [setChannel, channelSlug, projectId]);

  return null;
}
