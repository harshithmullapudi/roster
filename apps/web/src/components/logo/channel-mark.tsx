import { cn } from "@roster/ui";

import { FOLDER_PATH, FOLDER_VIEWBOX } from "~/utils/logo-paths";

import { Glyph } from "./glyph";

export function ChannelMark({ className }: { className?: string }) {
  return (
    <Glyph
      path={FOLDER_PATH}
      viewBox={FOLDER_VIEWBOX}
      label={null}
      className={cn(
        "size-[14px] shrink-0 text-current [shape-rendering:auto]",
        className,
      )}
    />
  );
}
