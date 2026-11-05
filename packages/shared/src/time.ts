// Friendly times, shared by the desktop and phone apps.

/** "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", then the date. */
export function relativeTime(epochS: number, nowMs = Date.now()): string {
  const s = Math.round(nowMs / 1000 - epochS);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 7) return `${d} days ago`;
  return new Date(epochS * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "now", "in 5 min", "in 2 h 10 min" for an upcoming start time. */
export function timeUntil(epochS: number, nowMs = Date.now()): string {
  const m = Math.round((epochS * 1000 - nowMs) / 60_000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `in ${h} h ${m % 60} min` : `in ${h} h`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
