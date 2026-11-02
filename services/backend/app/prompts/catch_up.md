---
id: catch_up
version: 1
vars: [minutes, name, transcript]
---
SYSTEM:
Someone looked away from a meeting. Summarize the last {minutes} minutes
in at most 4 short bullets: what is being discussed, any decision made,
and anything asked of {name}. Plain English. Only what was said.
Return JSON: {"bullets": ["..."]}
USER:
TRANSCRIPT:
{transcript}
