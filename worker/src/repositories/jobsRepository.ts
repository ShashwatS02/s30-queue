import { pool } from "../db/pool.js";

export async function upsertWorkerHeartbeat(input: {
  workerId: string;
  status: "idle" | "polling" | "processing" | "error" | "stopped";
  lastClaimedJobId?: string | null;
  lastError?: string | null;
}) {
  const { workerId, status, lastClaimedJobId = null, lastError = null } = input;

  await pool.query(
    `
      insert into workers (
        worker_id,
        status,
        started_at,
        last_heartbeat_at,
        last_claimed_job_id,
        last_error
      )
      values ($1, $2, now(), now(), $3, $4)
      on conflict (worker_id)
      do update set
        status = excluded.status,
        last_heartbeat_at = now(),
        last_claimed_job_id = excluded.last_claimed_job_id,
        last_error = excluded.last_error,
        updated_at = now()
    `,
    [workerId, status, lastClaimedJobId, lastError]
  );
}

export async function claimNextJob(workerId: string) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
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
      `,
      [workerId]
    );

    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markJobCompleted(jobId: string) {
  const result = await pool.query(
    `
      update jobs
      set
        status = 'completed',
        completed_at = now(),
        locked_at = null,
        locked_by = null,
        updated_at = now()
      where id = $1
      returning *;
    `,
    [jobId]
  );

  return result.rows[0] ?? null;
}

function getRetryDelaySeconds(attempts: number) {
  return Math.min(300, 5 * Math.pow(2, attempts));
}

export async function handleJobFailure(job: any, errorMessage: string) {
  const nextAttempts = Number(job.attempts) + 1;

  if (nextAttempts >= Number(job.max_attempts)) {
    const result = await pool.query(
      `
        update jobs
        set
          status = 'dead_letter',
          attempts = $2,
          failed_at = now(),
          last_error = $3,
          locked_at = null,
          locked_by = null,
          updated_at = now()
        where id = $1
        returning *;
      `,
      [job.id, nextAttempts, errorMessage]
    );

    return {
      action: "dead_letter",
      job: result.rows[0] ?? null
    };
  }

  const delaySeconds = getRetryDelaySeconds(nextAttempts);

  const result = await pool.query(
    `
      update jobs
      set
        status = 'pending',
        attempts = $2,
        last_error = $3,
        failed_at = now(),
        locked_at = null,
        locked_by = null,
        run_at = now() + ($4 || ' seconds')::interval,
        updated_at = now()
      where id = $1
      returning *;
    `,
    [job.id, nextAttempts, errorMessage, String(delaySeconds)]
  );

  return {
    action: "retry_scheduled",
    delaySeconds,
    job: result.rows[0] ?? null
  };
}
