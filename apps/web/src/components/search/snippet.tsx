import type { SnippetSegment } from "@roster/api";

export interface SnippetProps {
  snippet: SnippetSegment[];
  className?: string;
}

export function Snippet({ snippet, className }: SnippetProps) {
  return (
    <span className={className}>
      {snippet.map((segment, index) =>
        segment.hit ? (
          <mark
            key={index}
            className="text-foreground bg-transparent font-medium"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
