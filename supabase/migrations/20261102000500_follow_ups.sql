-- I'll follow up (Prompt 11): the question asked, and the reply drafted after the meeting.
alter table public.action_items
  add column question text,
  add column asker text,
  add column draft text;
