import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

router.get("/", async (_req, res) => {
  const countsResult = await pool.query(
    `
      select status, count(*)::int as count
      from jobs
      group by status
      order by status;
    `
  );

  const queueDepthResult = await pool.query(
    `
      select count(*)::int as pending_count
      from jobs
      where status = 'pending';
    `
  );

  const deadLetterResult = await pool.query(
    `
      select count(*)::int as dead_letter_count
      from jobs
      where status = 'dead_letter';
    `
  );

  const retryingResult = await pool.query(
    `
      select count(*)::int as retrying_count
      from jobs
      where attempts > 0 and status in ('pending', 'failed', 'dead_letter');
    `
  );

  const oldestPendingResult = await pool.query(
    `
      select extract(epoch from (now() - min(created_at)))::int as oldest_pending_age_seconds
      from jobs
      where status = 'pending';
    `
  );

  res.json({
    byStatus: countsResult.rows,
    queueDepth: queueDepthResult.rows[0]?.pending_count ?? 0,
    deadLetterCount: deadLetterResult.rows[0]?.dead_letter_count ?? 0,
    retryingCount: retryingResult.rows[0]?.retrying_count ?? 0,
    oldestPendingAgeSeconds: oldestPendingResult.rows[0]?.oldest_pending_age_seconds ?? 0
  });
});

export default router;
