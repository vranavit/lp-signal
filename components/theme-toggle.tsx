"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function readTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readTheme());
    setMounted(true);
  }, []);

  function apply(next: Theme) {
    const root = document.documentElement;
    if (next === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    try {
      localStorage.setItem("lp-theme", next);
    } catch {}
    setTheme(next);
  }

  const options: { value: Theme; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex border border-line rounded-sm p-0.5 bg-bg-subtle"
    >
      {options.map((opt) => {
        const active = mounted && theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => apply(opt.value)}
            className={
              "h-7 px-3 inline-flex items-center text-[12px] rounded-sm transition-colors duration-150 cursor-pointer " +
              (active
                ? "bg-bg text-ink border border-line"
                : "text-ink-muted hover:text-ink border border-transparent")
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
