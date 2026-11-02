import type { ReactNode } from "react";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="mb-6 flex items-center justify-between gap-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {children}
    </header>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center dark:border-gray-700">
      <p className="font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const buttonClass =
  "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 hc:bg-black hc:ring-2 hc:ring-yellow-400";
export const secondaryButtonClass =
  "rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900";
export const inputClass =
  "w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900";
