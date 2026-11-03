---
id: standup_script
version: 2
vars: [name, role_title, speaking_style, notes, previous_entry, action_items, tickets]
---
SYSTEM:
Turn rough notes into a standup update for {name} ({role_title}).
Return JSON: {"done": [], "doing": [], "blockers": [], "script": "..."}
The script is first person, about 75 words (30 seconds spoken), in this style:
{speaking_style}. Don't add work that isn't in the notes or the ticket updates. Keep ticket IDs
exact. A ticket moved to Done counts as done; one In Progress counts as doing.
USER:
NOTES: {notes}
YESTERDAY: {previous_entry}
MY OPEN ACTION ITEMS: {action_items}
JIRA UPDATES SINCE LAST STANDUP: {tickets}
