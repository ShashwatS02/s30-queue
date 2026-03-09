import { pool } from "../db/pool.js";

type RecoverResultItem = {
  id: string;
  action: "retry_scheduled" | "dead_letter";
  delaySeconds?: number;
};

function getRetryDelaySeconds(attempts: number) {
  return Math.min(300, 5 * Math.pow(2, attempts));
}

export async function recoverStaleProcessingJobs(input?: {
  staleLockSeconds?: number;
  staleHeartbeatSeconds?: number;
  limit?: number;
}) {
  const staleLockSeconds = input?.staleLockSeconds ?? 60;
  const staleHeartbeatSeconds = input?.staleHeartbeatSeconds ?? 20;
  const limit = input?.limit ?? 10;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const staleCandidates = await client.query(
      `
        select
          j.id,
          j.attempts,
          j.max_attempts,
          j.locked_by,
          j.locked_at
        from jobs j
        where j.status = 'processing'
          and j.locked_at is not null
          and (
            j.locked_at < now() - ($1 || ' seconds')::interval
            or (
              j.locked_by is not null
              and not exists (
                select 1
                from workers w
                where w.worker_id = j.locked_by
                  and w.last_heartbeat_at >= now() - ($2 || ' seconds')::interval
              )
            )
          )
        order by j.locked_at asc
        limit $3
        for update of j skip locked
      `,
      [String(staleLockSeconds), String(staleHeartbeatSeconds), limit]
    );

    const results: RecoverResultItem[] = [];

    for (const job of staleCandidates.rows) {
      const nextAttempts = Number(job.attempts) + 1;
      const recoveryMessage = `Recovered stale processing lock from ${job.locked_by ?? "unknown-worker"}`;

      if (nextAttempts >= Number(job.max_attempts)) {
        const deadLetterResult = await client.query(
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
              and status = 'processing'
              and locked_by is not distinct from $4
            returning id
          `,
          [job.id, nextAttempts, recoveryMessage, job.locked_by]
        );

        if ((deadLetterResult.rowCount ?? 0) > 0) {
          results.push({
            id: job.id,
            action: "dead_letter"
          });
        }

        continue;
      }

      const delaySeconds = getRetryDelaySeconds(nextAttempts);

      const retryResult = await client.query(
        `
          update jobs
          set
            status = 'pending',
            attempts = $2,
            failed_at = now(),
            last_error = $3,
            locked_at = null,
            locked_by = null,
            run_at = now() + ($4 || ' seconds')::interval,
            updated_at = now()
          where id = $1
            and status = 'processing'
            and locked_by is not distinct from $5
          returning id
        `,
        [job.id, nextAttempts, recoveryMessage, String(delaySeconds), job.locked_by]
      );

      if ((retryResult.rowCount ?? 0) > 0) {
        results.push({
          id: job.id,
          action: "retry_scheduled",
          delaySeconds
        });
      }
    }

    await client.query("COMMIT");
    return results;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
