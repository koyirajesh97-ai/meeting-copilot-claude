import { EmptyState, PageHeader } from "../components/EmptyState";

export function AskPage() {
  return (
    <section>
      <PageHeader title="Ask my meetings" />
      <EmptyState title="Coming soon" body="Ask a question across your meetings and get answers with links to the moment it was said." />
    </section>
  );
}
