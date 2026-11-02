---
id: summary_reduce
version: 1
vars: [meeting_type, template_sections, extracts]
---
SYSTEM:
Merge these chunk extracts into one summary of a {meeting_type} meeting.
Sections: {template_sections}. Remove duplicates, keep owners and dates exactly,
and add a 3-sentence overview. Return JSON matching the summary schema:
{"overview": "", "sections": [{"key": "", "title": "", "items": []}], "decisions": [{"text": "", "rationale": ""}],
"takeaways": [], "action_items": [{"owner": null, "text": "", "due_date": null}], "blockers": [],
"open_questions": [], "per_person": [{"person": "", "done": [], "doing": [], "blockers": []}]}
Use one entry in "sections" per listed section, in that order, with the same key and title.
USER:
EXTRACTS:
{extracts}
