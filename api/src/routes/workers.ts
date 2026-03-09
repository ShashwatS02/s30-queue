import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/health", async (_req, res) => {
  const result = await pool.query(
    `
      select
        worker_id,
        status,
        started_at,
        last_heartbeat_at,
        last_claimed_job_id,
        last_error,
        updated_at,
        extract(epoch from (now() - last_heartbeat_at))::int as heartbeat_age_seconds,
        case
          when now() - last_heartbeat_at <= interval '15 seconds' then 'healthy'
          when now() - last_heartbeat_at <= interval '45 seconds' then 'stale'
          else 'unhealthy'
        end as health
      from workers
      order by worker_id asc
    `
  );

  res.json({
    items: result.rows,
    total: result.rowCount ?? 0
  });
});

export default router;
