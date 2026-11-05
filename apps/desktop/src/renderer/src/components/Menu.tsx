import { useEffect, useRef, type ReactNode } from "react";

/** A small "More" menu: a button that opens a panel of less-used actions. */
export function Menu({ label = "More", children }: { label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Close when clicking anywhere outside it.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details ref={ref} className="relative">
      <summary
        className="cursor-pointer list-none rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800 [&::-webkit-details-marker]:hidden"
        role="button"
        aria-label={label}
      >
        {label} ▾
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-64 space-y-1 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
    </details>
  );
}

export function MenuItem({ onClick, children, danger = false }: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.currentTarget.closest("details")?.removeAttribute("open"); // picking an item closes the menu
        onClick();
      }}
      className={`block w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${danger ? "text-red-600 dark:text-red-400" : ""}`}
    >
      {children}
    </button>
  );
}
