"use client";

import { cn } from "@roster/ui";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

import {
  combinedAnswer,
  type QuestionGroup,
} from "~/utils/question-options";

export interface AnswerOptionsProps {
  groups: QuestionGroup[];
  asking: boolean;
  onAnswer: (text: string) => Promise<boolean>;
}

type Phase = "idle" | "sending" | "sent";

/**
 * One-click answers for the choices an agent offered as numbered lists.
 * A single question sends on click; several questions collect one choice
 * each and go out as one combined reply. The free-form composer below
 * stays available for any other answer.
 */
export function AnswerOptions({ groups, asking, onAnswer }: AnswerOptionsProps) {
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");

  const single = groups.length === 1;
  const complete = groups.every((_, index) => choices[index] !== undefined);

  const deliver = async (picked: Record<number, string>) => {
    setPhase("sending");
    const text = combinedAnswer(
      groups,
      groups.map((_, index) => picked[index] ?? ""),
    );
    let delivered = false;
    try {
      delivered = await onAnswer(text);
    } catch {}
    if (delivered) setPhase("sent");
    else setPhase("idle");
  };

  const choose = (group: number, option: string) => {
    if (phase !== "idle") return;
    const picked = { ...choices, [group]: option };
    setChoices(picked);
    if (single) void deliver(picked);
  };

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-2 px-3 pb-2.5 sm:px-5",
        asking ? "bg-warning/10" : "border-border border-t pt-2.5",
      )}
    >
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="flex flex-col gap-1.5">
          {!single && group.question ? (
            <span className="text-muted-foreground text-xs font-medium">
              {group.question}
            </span>
          ) : null}
          {group.options.map((option, optionIndex) => {
            const active = choices[groupIndex] === option;
            const locked = phase !== "idle" || (single && active);
            return (
              <button
                key={option}
                type="button"
                disabled={locked}
                onClick={() => choose(groupIndex, option)}
                className={cn(
                  "border-border bg-background flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors",
                  phase === "idle" &&
                    !active &&
                    "hover:border-warning/60 hover:bg-accent/50",
                  phase !== "idle" && !active && "opacity-50",
                  active && "border-warning/60 bg-accent/40",
                )}
              >
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {optionIndex + 1}
                </span>
                <span className="min-w-0 flex-1">{option}</span>
                {active && phase === "sent" && (
                  <Check size={14} className="text-success shrink-0" />
                )}
                {active && phase === "sending" && (
                  <Loader2 size={14} className="shrink-0 animate-spin" />
                )}
              </button>
            );
          })}
        </div>
      ))}

      {!single && phase !== "sent" ? (
        <button
          type="button"
          disabled={!complete || phase === "sending"}
          onClick={() => void deliver(choices)}
          className={cn(
            "bg-primary text-primary-foreground flex items-center justify-center gap-2 self-start rounded-md px-3 py-1.5 text-sm font-medium transition-opacity",
            (!complete || phase === "sending") && "opacity-50",
          )}
        >
          {phase === "sending" ? (
            <Loader2 size={14} className="animate-spin" />
          ) : null}
          Send answers
        </button>
      ) : null}
    </div>
  );
}
