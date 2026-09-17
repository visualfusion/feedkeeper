import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("fk_theme") as Theme) ?? "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    applyTheme(theme);
    try {
      if (theme === "system") localStorage.removeItem("fk_theme");
      else localStorage.setItem("fk_theme", theme);
    } catch {
      // localStorage may be unavailable (private browsing); theme just won't persist.
    }
  }, [theme]);

  function cycle() {
    setTheme((current) => (current === "light" ? "dark" : current === "dark" ? "system" : "light"));
  }

  const icon = theme === "light" ? "☀" : theme === "dark" ? "☾" : "◐";

  return (
    <button
      onClick={cycle}
      className="btn-secondary text-sm w-9 h-9 px-0 flex items-center justify-center"
      title={`Theme: ${theme}`}
    >
      {icon}
    </button>
  );
}
