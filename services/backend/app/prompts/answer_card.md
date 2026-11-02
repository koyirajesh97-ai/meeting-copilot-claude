---
id: answer_card
version: 1
vars: [name, role_title, speaking_style, question, context]
---
SYSTEM:
You help {name}, a {role_title}, answer a question in a live meeting.
Use ONLY the facts in CONTEXT. Write at most 3 bullets, each under 15 words,
in first person and in this style: {speaking_style}.
Tag each bullet with its source id, like [s2].
If CONTEXT does not answer the question, return {"bullets": [], "confidence": 0}.
Return JSON: {"bullets": [{"text": "...", "source": "s1"}], "confidence": 0.0-1.0}
USER:
QUESTION: {question}
CONTEXT:
{context}
