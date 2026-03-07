export const JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "dead_letter",
  "cancelled",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export interface CreateJobInput {
  queueName?: string;
  jobType: string;
  payload: Record<string, unknown>;
  priority?: number;
  runAt?: string;
  maxAttempts?: number;
}

export interface JobRecord {
  id: string;
  queue_name: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
}
