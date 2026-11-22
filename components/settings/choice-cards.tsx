"use client";
import { CheckIcon } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/** A row of picture cards that behaves as one radio group: arrow keys move the selection. */
export function ChoiceCards<T extends string>({ label, value, options, onChange, className }: {
  label: string;
  value: T;
  options: { value: T; label: string; description?: string; preview: React.ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, step: number) => {
    const next = (from + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-3", className)}>
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
              if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
            }}
            className={cn(
              "group focus-visible:ring-ring relative flex flex-col overflow-hidden rounded-lg border text-left outline-none transition-[border-color,box-shadow] focus-visible:ring-2 world:rounded-none",
              checked ? "border-foreground/60 ring-foreground/60 ring-1" : "hover:border-foreground/30",
            )}
          >
            <span className="block aspect-[16/9] w-full overflow-hidden border-b" aria-hidden="true">{option.preview}</span>
            <span className="flex items-start gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-sm">{option.label}</span>
                {option.description && <span className="text-muted-foreground block text-xs leading-snug">{option.description}</span>}
              </span>
              <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", checked && "bg-foreground text-background border-foreground")}>
                {checked && <CheckIcon className="size-3" strokeWidth={3} />}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
