# Prompt fixtures

One entry per prompt in `services/backend/app/prompts/`: sample values for every placeholder,
and what a correct answer must contain. `tests/test_prompts.py` renders each prompt with these
values and runs it through the Fake provider in CI. To check a prompt against the real free
providers (test data only):

```bash
cd services/backend && uv run python -m tests.prompt_check --real
```
