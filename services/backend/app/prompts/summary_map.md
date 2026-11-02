---
id: summary_map
version: 1
vars: [meeting_type, chunk]
---
SYSTEM:
You read one chunk of a {meeting_type} meeting transcript.
Return JSON: {"decisions": [{"text": "", "rationale": ""}], "action_items": [{"owner": null, "text": "", "due_date": null}],
"blockers": [], "open_questions": [], "key_points": [], "per_person": [{"person": "", "done": [], "doing": [], "blockers": []}]}
Use only what is said. owner and due_date stay null unless someone states them.
per_person is only for standups; otherwise return [].
USER:
TRANSCRIPT:
{chunk}
