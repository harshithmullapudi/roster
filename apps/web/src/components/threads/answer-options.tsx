"use client";

import { cn } from "@roster/ui";
import { Check, Loader2 } from "lucide-react";
import { useState } from "react";

export interface AnswerOptionsProps {
  options: string[];
  onAnswer: (option: string) => Promise<boolean>;
}

/**
 * One-click answers for a question the agent asked with a numbered list.
 * Clicking a choice sends it as the reply; the free-form composer below
 * stays available for any other answer.
 */
export function AnswerOptions({ options, onAnswer }: AnswerOptionsProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const answer = async (option: string) => {
    if (chosen !== null) return;
    setChosen(option);
    let delivered = false;
    try {
      delivered = await onAnswer(option);
    } catch {}
    if (delivered) setSent(true);
    else setChosen(null);
  };

  return (
    <div className="bg-warning/10 flex shrink-0 flex-col gap-1.5 px-3 pb-2.5 sm:px-5">
      {options.map((option, index) => {
        const active = chosen === option;
        return (
          <button
            key={option}
            type="button"
            disabled={chosen !== null}
            onClick={() => void answer(option)}
            className={cn(
              "border-border bg-background flex items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm transition-colors",
              chosen === null && "hover:border-warning/60 hover:bg-accent/50",
              chosen !== null && !active && "opacity-50",
              active && "border-warning/60",
            )}
          >
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">{option}</span>
            {active &&
              (sent ? (
                <Check size={14} className="text-success shrink-0" />
              ) : (
                <Loader2 size={14} className="shrink-0 animate-spin" />
              ))}
          </button>
        );
      })}
    </div>
  );
}
