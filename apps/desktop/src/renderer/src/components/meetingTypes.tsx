import { AudioLines, BookOpen, Briefcase, CalendarRange, GitPullRequest, MessagesSquare, Siren, Users, type LucideIcon } from "lucide-react";

/** An icon and a colour per meeting type, so a list can be scanned at a glance. */
const TYPES: Record<string, { icon: LucideIcon; tile: string }> = {
  standup: { icon: Users, tile: "bg-sky-50 text-sky-600 ring-sky-100 dark:bg-sky-950/60 dark:text-sky-300 dark:ring-sky-900" },
  review: { icon: GitPullRequest, tile: "bg-violet-50 text-violet-600 ring-violet-100 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900" },
  planning: { icon: CalendarRange, tile: "bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900" },
  incident: { icon: Siren, tile: "bg-rose-50 text-rose-600 ring-rose-100 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900" },
  client: { icon: Briefcase, tile: "bg-emerald-50 text-emerald-600 ring-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900" },
  one_on_one: { icon: MessagesSquare, tile: "bg-pink-50 text-pink-600 ring-pink-100 dark:bg-pink-950/60 dark:text-pink-300 dark:ring-pink-900" },
  research: { icon: BookOpen, tile: "bg-teal-50 text-teal-600 ring-teal-100 dark:bg-teal-950/60 dark:text-teal-300 dark:ring-teal-900" },
};
const OTHER = { icon: AudioLines, tile: "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700" };

export function TypeTile({ type, size = "md" }: { type: string; size?: "md" | "lg" }) {
  const t = TYPES[type] ?? OTHER;
  const Icon = t.icon;
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ring-1 ${t.tile} ${size === "lg" ? "h-12 w-12" : "h-10 w-10"}`} aria-hidden>
      <Icon size={size === "lg" ? 22 : 18} strokeWidth={2} />
    </span>
  );
}
