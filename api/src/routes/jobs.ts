import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";

const router = Router();

const createJobSchema = z.object({
  queueName: z.string().min(1).default("default"),
  jobType: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  priority: z.number().int().min(0).max(100).default(50),
  runAt: z.string().datetime().optional(),
  maxAttempts: z.number().int().min(1).max(20).default(5)
});

const listJobsQuerySchema = z.object({
  status: z.string().optional(),
  jobType: z.string().optional(),
  queueName: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sortBy: z.enum(["created_at", "updated_at", "priority", "run_at"]).default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc")
});

router.post("/", async (req, res) => {
  const parsed = createJobSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.flatten()
    });
  }

  const { queueName, jobType, payload, priority, runAt, maxAttempts } = parsed.data;

  const result = await pool.query(
    `
      insert into jobs (
        queue_name,
        job_type,
        payload,
        status,
        priority,
        run_at,
        max_attempts
      )
      values ($1, $2, $3, 'pending', $4, coalesce($5::timestamptz, now()), $6)
      returning *
    `,
    [queueName, jobType, payload, priority, runAt ?? null, maxAttempts]
  );

  res.status(201).json(result.rows[0]);
});

router.get("/", async (req, res) => {
  const parsed = listJobsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid query params",
      details: parsed.error.flatten()
    });
  }

  const { status, jobType, queueName, page, pageSize, sortBy, sortOrder } = parsed.data;

  const where: string[] = [];
  const values: unknown[] = [];

  if (status) {
    values.push(status);
    where.push(`status = $${values.length}`);
  }

  if (jobType) {
    values.push(jobType);
    where.push(`job_type = $${values.length}`);
  }

  if (queueName) {
    values.push(queueName);
    where.push(`queue_name = $${values.length}`);
  }

  const whereClause = where.length ? `where ${where.join(" and ")}` : "";
  const offset = (page - 1) * pageSize;

  const totalQuery = `
    select count(*)::int as total
    from jobs
    ${whereClause}
  `;

  const totalResult = await pool.query(totalQuery, values);
  const total = totalResult.rows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  values.push(pageSize);
  values.push(offset);

  const dataQuery = `
    select *
    from jobs
    ${whereClause}
    order by ${sortBy} ${sortOrder}
    limit $${values.length - 1}
    offset $${values.length}
  `;

  const result = await pool.query(dataQuery, values);

  res.json({
    items: result.rows,
    total,
    page,
    pageSize,
    totalPages
  });
});

router.get("/:id", async (req, res) => {
  const result = await pool.query(
    `
      select *
      from jobs
      where id = $1
      limit 1
    `,
    [req.params.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json(result.rows[0]);
});

router.post("/:id/cancel", async (req, res) => {
  const result = await pool.query(
    `
      update jobs
      set
        status = 'cancelled',
        locked_at = null,
        locked_by = null,
        updated_at = now()
      where id = $1
        and status = 'pending'
      returning *
    `,
    [req.params.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({
      error: "Cancel failed or job not eligible"
    });
  }

  res.json(result.rows[0]);
});

router.post("/:id/retry", async (req, res) => {
  const result = await pool.query(
    `
      update jobs
      set
        status = 'pending',
        attempts = 0,
        run_at = now(),
        locked_at = null,
        locked_by = null,
        completed_at = null,
        failed_at = null,
        last_error = null,
        updated_at = now()
      where id = $1
        and status in ('failed', 'dead_letter')
      returning *
    `,
    [req.params.id]
  );

  if (!result.rows[0]) {
    return res.status(404).json({
      error: "Retry failed or job not eligible"
    });
  }

  res.json(result.rows[0]);
});

export default router;
