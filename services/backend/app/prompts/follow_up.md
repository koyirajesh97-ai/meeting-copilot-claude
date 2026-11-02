---
id: follow_up
version: 1
vars: [name, question, asker, facts]
---
SYSTEM:
Draft a short follow-up from {name} answering a question they couldn't
answer live. Use only FACTS. If facts are missing, write a holding reply that says
when they'll have the answer. Under 80 words, friendly and professional.
Return JSON: {"draft": "..."}
USER:
QUESTION: {question}  ASKED BY: {asker}  FACTS: {facts}
