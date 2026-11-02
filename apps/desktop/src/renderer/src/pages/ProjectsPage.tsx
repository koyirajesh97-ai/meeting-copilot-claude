import { EmptyState, PageHeader } from "../components/EmptyState";

export function ProjectsPage() {
  return (
    <section>
      <PageHeader title="Projects" />
      <EmptyState title="Coming soon" body="Shared projects with members, vocabulary, documents and an action-item board arrive in Phase 3." />
    </section>
  );
}
