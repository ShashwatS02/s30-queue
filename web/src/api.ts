const API_BASE = "/api";

export type Job = {
  id: string;
  queue_name: string;
  job_type: string;
  payload: Record<string, unknown>;
  status: string;
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
};

export type QueueStats = {
  byStatus: Array<{ status: string; count: number }>;
  queueDepth: number;
  deadLetterCount: number;
  retryingCount: number;
  oldestPendingAgeSeconds: number;
};

export type WorkerHealth = {
  worker_id: string;
  status: string;
  started_at: string;
  last_heartbeat_at: string;
  last_claimed_job_id: string | null;
  last_error: string | null;
  updated_at: string;
  heartbeat_age_seconds: number;
  health: "healthy" | "stale" | "unhealthy";
};

export type JobsResponse = {
  items: Job[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type CreateJobInput = {
  queueName?: string;
  jobType: string;
  payload: Record<string, unknown>;
  priority?: number;
  runAt?: string;
  maxAttempts?: number;
};

export async function fetchStats(): Promise<QueueStats> {
  const res = await fetch(`${API_BASE}/queues/stats`);
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

export async function fetchJobs(params?: {
  status?: string;
  jobType?: string;
  queueName?: string;
  page?: number;
  pageSize?: number;
}): Promise<JobsResponse> {
  const search = new URLSearchParams();

  if (params?.status && params.status !== "all") search.set("status", params.status);
  if (params?.jobType) search.set("jobType", params.jobType);
  if (params?.queueName) search.set("queueName", params.queueName);
  if (params?.page) search.set("page", String(params.page));
  if (params?.pageSize) search.set("pageSize", String(params.pageSize));

  const qs = search.toString();
  const res = await fetch(`${API_BASE}/jobs${qs ? `?${qs}` : ""}`);

  if (!res.ok) throw new Error("Failed to fetch jobs");
  return res.json();
}

export async function fetchJobById(id: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${id}`);
  if (!res.ok) throw new Error("Failed to fetch job");
  return res.json();
}

export async function fetchWorkers(): Promise<{ items: WorkerHealth[]; total: number }> {
  const res = await fetch(`${API_BASE}/workers/health`);
  if (!res.ok) throw new Error("Failed to fetch workers");
  return res.json();
}

export async function retryJob(id: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${id}/retry`, {
    method: "POST"
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to retry job");
  }

  return res.json();
}

export async function cancelJob(id: string): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs/${id}/cancel`, {
    method: "POST"
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to cancel job");
  }

  return res.json();
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to create job");
  }

  return res.json();
}
