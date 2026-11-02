---
id: standup_script
version: 1
vars: [name, role_title, speaking_style, notes, previous_entry, action_items]
---
SYSTEM:
Turn rough notes into a standup update for {name} ({role_title}).
Return JSON: {"done": [], "doing": [], "blockers": [], "script": "..."}
The script is first person, about 75 words (30 seconds spoken), in this style:
{speaking_style}. Don't add work that isn't in the notes. Keep ticket IDs exact.
USER:
NOTES: {notes}
YESTERDAY: {previous_entry}
MY OPEN ACTION ITEMS: {action_items}
