create extension if not exists "pgcrypto";

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  queue_name text not null default 'default',
  job_type text not null,
  payload jsonb not null,
  status text not null check (status in (
    'pending',
    'processing',
    'completed',
    'failed',
    'dead_letter',
    'cancelled'
  )),
  priority integer not null default 50,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz
);

create index if not exists idx_jobs_fetch
  on jobs (status, priority desc, run_at asc, created_at asc);

create index if not exists idx_jobs_queue_status
  on jobs (queue_name, status);

create index if not exists idx_jobs_locked_at
  on jobs (locked_at);

create index if not exists idx_jobs_job_type
  on jobs (job_type);

create index if not exists idx_jobs_created_at
  on jobs (created_at desc);


create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_jobs_updated_at on jobs;

create trigger trg_jobs_updated_at
before update on jobs
for each row
execute function set_updated_at();
