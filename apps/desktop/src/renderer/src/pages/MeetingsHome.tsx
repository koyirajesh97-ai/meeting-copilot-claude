import { Link } from "react-router-dom";
import { buttonClass, EmptyState, inputClass, PageHeader } from "../components/EmptyState";

export function MeetingsHome() {
  return (
    <section>
      <PageHeader title="Meetings">
        <Link to="/start" className={buttonClass}>
          Start meeting
        </Link>
      </PageHeader>
      <input type="search" placeholder="Search meetings" aria-label="Search meetings" className={`${inputClass} mb-6`} disabled />
      <EmptyState
        title="No meetings yet"
        body="Start a meeting and its transcript, summary and action items will show up here."
      />
    </section>
  );
}
