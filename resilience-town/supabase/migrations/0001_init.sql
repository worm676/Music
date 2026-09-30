-- Resilience Town: tasks table, realtime, and one demo task per agent.

create extension if not exists pgcrypto;

create table if not exists public.tasks (
  id              uuid primary key default gen_random_uuid(),
  agent_id        text not null,
  title           text not null,
  instructions    text not null default '',
  priority        text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_date        date,
  status          text not null default 'queued' check (status in ('queued','working','needs_input','done','error')),
  result          text,
  steps           jsonb not null default '[]'::jsonb,
  parent_task_id  uuid references public.tasks(id) on delete set null,
  conversation    jsonb,           -- Claude message history, so paused tasks can resume
  pending_action  jsonb,           -- tool calls waiting on the operator (questions / approvals)
  approved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists tasks_status_created_idx on public.tasks (status, created_at);
create index if not exists tasks_agent_idx on public.tasks (agent_id, created_at desc);
create index if not exists tasks_parent_idx on public.tasks (parent_task_id);

create or replace function public.tasks_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tasks_touch_updated_at on public.tasks;
create trigger tasks_touch_updated_at before update on public.tasks
  for each row execute function public.tasks_touch_updated_at();

-- Row Level Security: the browser (anon key) may only read, for Realtime.
-- All writes go through the Next.js API routes using the service role key.
alter table public.tasks enable row level security;
drop policy if exists "tasks are readable" on public.tasks;
create policy "tasks are readable" on public.tasks for select to anon, authenticated using (true);

-- Realtime: broadcast full rows on insert/update/delete.
alter table public.tasks replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
  ) then
    alter publication supabase_realtime add table public.tasks;
  end if;
end $$;

-- Seed: one demo task per agent (sits in the queue until you press Run).
insert into public.tasks (agent_id, title, instructions, priority)
select * from (values
  ('chief',   'Plan Q4 growth push',
   'Goal: land 5 new infrastructure clients this quarter. Break this into subtasks for the team (research, outreach, marketing, delivery readiness, CRM hygiene).', 'high'),
  ('scout',   'Competitor scan: business infrastructure agencies',
   'Find 5 competitors offering done-for-you sales + delivery infrastructure to small businesses. Compare offers, pricing signals and positioning. Recommend how we differentiate.', 'normal'),
  ('closer',  'Cold outreach sequence for local service businesses',
   'Draft a 3-email cold sequence for owners of local service businesses (HVAC, roofing, cleaning) doing $500k-$3M/yr. Offer a free systems audit. Drafts only, do not send.', 'normal'),
  ('spark',   'LinkedIn content plan (2 weeks)',
   'Create a 2-week LinkedIn posting plan for Jhonathon: 6 posts about scaling a business with better systems. Include hooks and full post copy.', 'normal'),
  ('builder', 'New client onboarding checklist',
   'Write the onboarding checklist for a new client from signed contract to kickoff call to first deliverable in 14 days.', 'normal'),
  ('keeper',  'Log demo lead in CRM',
   'Upsert a contact: Dana Reyes, dana@example.com, Reyes Roofing, stage ''Discovery call booked'', note ''Interested in sales pipeline setup''.', 'low')
) as seed(agent_id, title, instructions, priority)
where not exists (select 1 from public.tasks);
