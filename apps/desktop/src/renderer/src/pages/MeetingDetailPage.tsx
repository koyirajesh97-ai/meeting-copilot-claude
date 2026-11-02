import { EmptyState, PageHeader } from "../components/EmptyState";

export function MeetingDetailPage() {
  return (
    <section>
      <PageHeader title="Meeting" />
      <EmptyState title="Coming soon" body="Transcript, summary and action items for this meeting appear here after it ends." />
    </section>
  );
}
