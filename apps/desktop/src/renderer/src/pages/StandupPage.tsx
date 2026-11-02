import { EmptyState, PageHeader } from "../components/EmptyState";

export function StandupPage() {
  return (
    <section>
      <PageHeader title="Standup prep" />
      <EmptyState title="Coming soon" body="Type rough notes and get done / doing / blockers and a 30-second script." />
    </section>
  );
}
