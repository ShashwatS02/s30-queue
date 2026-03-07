with next_job as (
  select id
  from jobs
  where status = 'pending'
    and run_at <= now()
  order by priority desc, run_at asc, created_at asc
  for update skip locked
  limit 1
)
update jobs
set
  status = 'processing',
  locked_at = now(),
  locked_by = $1,
  updated_at = now()
from next_job
where jobs.id = next_job.id
returning jobs.*;
