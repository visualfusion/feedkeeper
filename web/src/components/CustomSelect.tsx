import { useState, useRef, useEffect, useId, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  badge?: string | number;
  icon?: ReactNode;
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  ariaLabel?: string;
}

export function CustomSelect({
  value,
  onChange,
  options,
  placeholder,
  className = "",
  size = "md",
  disabled = false,
  ariaLabel,
}: CustomSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const id = useId();

  const selectedOption = options.find((opt) => opt.value === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("pointerdown", handleClickOutside);
      return () => document.removeEventListener("pointerdown", handleClickOutside);
    }
  }, [open]);

  // Reset highlight when opened
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((opt) => opt.value === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [open, value, options]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (open && highlightedIndex >= 0 && listboxRef.current) {
      const el = listboxRef.current.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`);
      if (el) {
        el.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, open]);

  function handleKeyDown(e: KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlightedIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < options.length) {
        onChange(options[highlightedIndex].value);
        setOpen(false);
      }
    }
  }

  // Group options while preserving flat indices for keyboard navigation
  const grouped: Array<{ groupName: string | null; items: Array<{ opt: SelectOption; index: number }> }> = [];
  options.forEach((opt, index) => {
    const groupName = opt.group ?? null;
    let group = grouped.find((g) => g.groupName === groupName);
    if (!group) {
      group = { groupName, items: [] };
      grouped.push(group);
    }
    group.items.push({ opt, index });
  });

  const isSmall = size === "sm";

  return (
    <div
      ref={containerRef}
      className={`relative inline-block ${className}`}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={open && highlightedIndex >= 0 ? `${id}-option-${highlightedIndex}` : undefined}
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        className={`w-full flex items-center justify-between gap-2 text-left font-normal transition-colors cursor-pointer select-none rounded-lg border bg-[var(--c-surface)] text-[var(--c-text)] shadow-xs hover:border-[var(--c-blue3)] focus:outline-none focus:border-[var(--c-blue3)] ${
          open ? "border-[var(--c-blue3)]" : "border-[var(--c-border)]"
        } ${
          isSmall ? "px-2.5 py-1 text-xs min-h-[30px]" : "px-3 py-1.5 text-sm min-h-[38px]"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        <span className="truncate flex items-center gap-1.5">
          {selectedOption ? (
            <>
              {selectedOption.icon}
              <span className="truncate">{selectedOption.label}</span>
              {selectedOption.badge !== undefined && (
                <span
                  className="text-[10px] px-1.5 py-0.2 rounded-full font-medium shrink-0"
                  style={{ backgroundColor: "var(--c-border)", color: "var(--c-text-muted)" }}
                >
                  {selectedOption.badge}
                </span>
              )}
            </>
          ) : (
            <span style={{ color: "var(--c-text-muted)" }}>{placeholder ?? "—"}</span>
          )}
        </span>

        <svg
          className={`shrink-0 transition-transform duration-200 opacity-60 ${
            open ? "rotate-180" : ""
          } ${isSmall ? "w-3 h-3" : "w-3.5 h-3.5"}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 mt-1 w-full min-w-[180px] max-w-xs sm:max-w-none rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] shadow-lg z-50 overflow-hidden"
          style={{ backdropFilter: "blur(8px)" }}
        >
          <ul
            ref={listboxRef}
            id={`${id}-listbox`}
            role="listbox"
            aria-labelledby={id}
            className="max-h-60 overflow-y-auto py-1 text-[var(--c-text)] focus:outline-none"
          >
            {options.length === 0 ? (
              <li
                className="px-3 py-2 text-xs italic"
                style={{ color: "var(--c-text-muted)" }}
              >
                {placeholder ?? t("common.noOptions")}
              </li>
            ) : (
              grouped.map((group, gIdx) => (
                <li
                  key={group.groupName ?? `ungrouped-${gIdx}`}
                  role="group"
                  aria-label={group.groupName ?? undefined}
                >
                  {group.groupName && (
                    <div
                      className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider select-none border-t first:border-t-0"
                      style={{
                        borderColor: "var(--c-border)",
                        color: "var(--c-text-muted)",
                      }}
                    >
                      {group.groupName}
                    </div>
                  )}
                  <ul role="presentation">
                    {group.items.map(({ opt, index }) => {
                      const isSelected = opt.value === value;
                      const isHighlighted = index === highlightedIndex;

                      return (
                        <li
                          key={opt.value}
                          id={`${id}-option-${index}`}
                          data-index={index}
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            onChange(opt.value);
                            setOpen(false);
                          }}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          className={`flex items-center justify-between gap-2 cursor-pointer select-none transition-colors ${
                            isSmall ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
                          } ${
                            isHighlighted
                              ? "bg-[var(--c-border)]/40 text-[var(--c-text)]"
                              : "text-[var(--c-text)]"
                          } ${isSelected ? "font-medium bg-[var(--c-blue1)]/10" : ""}`}
                        >
                          <span className="truncate flex items-center gap-1.5">
                            {opt.icon}
                            <span className="truncate">{opt.label}</span>
                            {opt.badge !== undefined && (
                              <span
                                className="text-[10px] px-1.5 py-0.2 rounded-full font-medium shrink-0"
                                style={{
                                  backgroundColor: "var(--c-border)",
                                  color: "var(--c-text-muted)",
                                }}
                              >
                                {opt.badge}
                              </span>
                            )}
                          </span>

                          {isSelected && (
                            <svg
                              className="w-3.5 h-3.5 shrink-0"
                              style={{ color: "var(--c-blue3)" }}
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
