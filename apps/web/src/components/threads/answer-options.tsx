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
 * A single question sends on click; several questions show as numbered
 * tabs, one question at a time — picking an option moves to the next
 * unanswered tab, and one send delivers every answer as a single reply.
 * The free-form composer below stays available for any other answer.
 */
export function AnswerOptions({ groups, asking, onAnswer }: AnswerOptionsProps) {
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [tab, setTab] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");

  const single = groups.length === 1;
  const complete = groups.every((_, index) => choices[index] !== undefined);
  const group = groups[tab] ?? groups[0]!;

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

  const choose = (option: string) => {
    if (phase !== "idle") return;
    const picked = { ...choices, [tab]: option };
    setChoices(picked);
    if (single) {
      void deliver(picked);
      return;
    }
    const next = groups.findIndex(
      (_, index) => picked[index] === undefined,
    );
    if (next !== -1) setTab(next);
  };

  return (
    <div
      className={cn(
        "flex shrink-0 flex-col gap-1.5 px-3 pb-2.5 sm:px-5",
        asking ? "bg-warning/10" : "border-border border-t pt-2.5",
      )}
    >
      {!single ? (
        <div className="flex items-center gap-1">
          {groups.map((_, index) => {
            const answered = choices[index] !== undefined;
            return (
              <button
                key={index}
                type="button"
                disabled={phase !== "idle"}
                onClick={() => setTab(index)}
                aria-current={index === tab ? "step" : undefined}
                className={cn(
                  "flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-sm tabular-nums transition-colors",
                  index === tab
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {index + 1}
                {answered && <Check size={12} className="text-success" />}
              </button>
            );
          })}
          <span className="text-muted-foreground ml-1 text-xs">
            {Object.keys(choices).length}/{groups.length} answered
          </span>
        </div>
      ) : null}

      {!single && group.question ? (
        <span className="text-sm font-medium">{group.question}</span>
      ) : null}

      {group.options.map((option, optionIndex) => {
        const active = choices[tab] === option;
        return (
          <button
            key={option}
            type="button"
            disabled={phase !== "idle"}
            onClick={() => choose(option)}
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
            {active && phase === "idle" && !single && (
              <Check size={14} className="text-success shrink-0" />
            )}
          </button>
        );
      })}

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
