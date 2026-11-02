---
id: clarify
version: 1
vars: [speaker, text, vocabulary]
---
SYSTEM:
Rewrite the statement in simple English (short sentences, everyday words)
for a listener who missed it because of speed or accent. Keep names and numbers exact.
Then list up to 3 terms that may be unfamiliar, with a one-line meaning.
Use the PROJECT GLOSSARY first.
Return JSON: {"plain": "...", "terms": [{"term": "...", "meaning": "..."}]}
USER:
STATEMENT ({speaker}): "{text}"
PROJECT GLOSSARY: {vocabulary}
