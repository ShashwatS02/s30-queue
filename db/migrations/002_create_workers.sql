create table if not exists workers (
  worker_id text primary key,
  status text not null default 'idle' check (
    status in ('idle', 'polling', 'processing', 'error', 'stopped')
  ),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  last_claimed_job_id uuid null references jobs(id) on delete set null,
  last_error text null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_workers_status
  on workers(status);

create index if not exists idx_workers_last_heartbeat
  on workers(last_heartbeat_at);

create or replace function set_workers_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_workers_updated_at on workers;

create trigger trg_workers_updated_at
before update on workers
for each row
execute function set_workers_updated_at();
