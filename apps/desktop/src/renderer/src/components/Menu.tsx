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
        className="cursor-pointer list-none rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900 [&::-webkit-details-marker]:hidden"
        role="button"
        aria-label={label}
      >
        {label} ▾
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-64 space-y-1 rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-800 dark:bg-gray-950">
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
      className={`block w-full px-3 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-900 ${danger ? "text-red-600 dark:text-red-400" : ""}`}
    >
      {children}
    </button>
  );
}
