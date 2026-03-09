import { useEffect, useMemo, useState } from "react";
import {
  cancelJob,
  createJob,
  fetchJobById,
  fetchJobs,
  fetchStats,
  fetchWorkers,
  retryJob,
  type Job,
  type QueueStats,
  type WorkerHealth
} from "./api.js";

const EMPTY_STATS: QueueStats = {
  byStatus: [],
  queueDepth: 0,
  deadLetterCount: 0,
  retryingCount: 0,
  oldestPendingAgeSeconds: 0
};

const QUICK_FILTERS = [
  { label: "All tasks", value: "all" },
  { label: "Waiting", value: "pending" },
  { label: "In progress", value: "processing" },
  { label: "Needs attention", value: "dead_letter" },
  { label: "Completed", value: "completed" }
];

const TASK_LIFECYCLE = [
  {
    title: "1. Task created",
    text: "An API request creates a new task and stores it in the jobs table."
  },
  {
    title: "2. Waiting in queue",
    text: "The task sits in pending state until a worker is free to pick it up."
  },
  {
    title: "3. Worker claims it",
    text: "A background worker locks the task and starts processing it."
  },
  {
    title: "4. Success or failure",
    text: "If it succeeds, it becomes completed. If it fails, it may be retried."
  },
  {
    title: "5. Final handling",
    text: "If retries are exhausted, the task moves to needs attention for manual review."
  }
];

function getFriendlyStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Waiting";
    case "processing":
      return "In progress";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "dead_letter":
      return "Needs attention";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

function getStatusHelpText(status: string) {
  switch (status) {
    case "pending":
      return "Task is waiting for a worker.";
    case "processing":
      return "Task is being worked on right now.";
    case "completed":
      return "Task finished successfully.";
    case "failed":
      return "Task failed, but may still be retried.";
    case "dead_letter":
      return "Task failed too many times and now needs manual review.";
    case "cancelled":
      return "Task was stopped manually.";
    default:
      return "Task state.";
  }
}

function getFriendlyHealthLabel(health: WorkerHealth["health"]) {
  switch (health) {
    case "healthy":
      return "Healthy";
    case "stale":
      return "Late heartbeat";
    case "unhealthy":
      return "Unhealthy";
    default:
      return health;
  }
}

function getFriendlyWorkerStatus(status: string) {
  switch (status) {
    case "idle":
      return "Idle";
    case "polling":
      return "Checking for work";
    case "processing":
      return "Working on a task";
    case "error":
      return "Error state";
    case "stopped":
      return "Stopped";
    default:
      return status;
  }
}

function getDerivedTaskMessage(job: Job) {
  switch (job.status) {
    case "pending":
      return "This task is waiting in the queue for a worker.";
    case "processing":
      return "This task is currently being processed by a worker.";
    case "completed":
      return "This task finished successfully.";
    case "failed":
      return "This task failed and may still be retried.";
    case "dead_letter":
      return "This task failed too many times and now needs manual review.";
    case "cancelled":
      return "This task was cancelled before completion.";
    default:
      return "Task state available.";
  }
}

function getTimelineItems(job: Job) {
  return [
    {
      label: "Created",
      value: job.created_at,
      active: true
    },
    {
      label: "Scheduled",
      value: job.run_at,
      active: true
    },
    {
      label: "Claimed",
      value: job.locked_at,
      active: Boolean(job.locked_at)
    },
    {
      label: "Completed",
      value: job.completed_at,
      active: Boolean(job.completed_at)
    },
    {
      label: "Failed",
      value: job.failed_at,
      active: Boolean(job.failed_at)
    }
  ];
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [deadLetterJobs, setDeadLetterJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<QueueStats>(EMPTY_STATS);
  const [workers, setWorkers] = useState<WorkerHealth[]>([]);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [confirmingCancelJob, setConfirmingCancelJob] = useState<Job | null>(null);
  const [cancellingJob, setCancellingJob] = useState(false);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [lastUpdated, setLastUpdated] = useState<string>("never");

  const [searchText, setSearchText] = useState("");
  const [creatingJob, setCreatingJob] = useState(false);
  const [newQueueName, setNewQueueName] = useState("default");
  const [newJobType, setNewJobType] = useState("flaky_mock");
  const [newPriority, setNewPriority] = useState(50);
  const [newMaxAttempts, setNewMaxAttempts] = useState(5);
  const [newPayloadText, setNewPayloadText] = useState('{\n  "note": "created from dashboard"\n}');

  async function loadData(showLoader = false) {
    try {
      setError("");

      if (showLoader) setLoading(true);
      else setRefreshing(true);

      const [statsRes, jobsRes, workersRes, deadLetterRes, selectedJobRes] =
        await Promise.allSettled([
          fetchStats(),
          fetchJobs({ status: statusFilter, page, pageSize }),
          fetchWorkers(),
          fetchJobs({ status: "dead_letter", page: 1, pageSize: 5 }),
          selectedJob ? fetchJobById(selectedJob.id) : Promise.resolve(null)
        ]);

      const errors: string[] = [];

      if (statsRes.status === "fulfilled") {
        setStats(statsRes.value);
      } else {
        errors.push("Failed to load queue summary");
      }

      if (jobsRes.status === "fulfilled") {
        setJobs(jobsRes.value.items);
        setTotalPages(jobsRes.value.totalPages || 1);
      } else {
        setJobs([]);
        setTotalPages(1);
        errors.push("Failed to load recent tasks");
      }

      if (workersRes.status === "fulfilled") {
        setWorkers(workersRes.value.items);
      } else {
        setWorkers([]);
        errors.push("Failed to load worker health");
      }

      if (deadLetterRes.status === "fulfilled") {
        setDeadLetterJobs(deadLetterRes.value.items);
      } else {
        setDeadLetterJobs([]);
        errors.push("Failed to load tasks needing attention");
      }

      if (selectedJobRes.status === "fulfilled") {
        setSelectedJob(selectedJobRes.value);
      } else if (selectedJob) {
        errors.push("Failed to refresh selected task details");
      }

      setLastUpdated(new Date().toLocaleTimeString());

      if (errors.length > 0) {
        setError(errors.join(" | "));
      }
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData(true);
  }, [statusFilter, page]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadData(false);
    }, 5000);

    return () => clearInterval(timer);
  }, [statusFilter, page, selectedJob?.id]);

  useEffect(() => {
    if (!successMessage) return;

    const timer = setTimeout(() => {
      setSuccessMessage("");
    }, 3000);

    return () => clearTimeout(timer);
  }, [successMessage]);

  const staleWorkers = useMemo(
    () => workers.filter((worker) => worker.health === "stale" || worker.health === "unhealthy"),
    [workers]
  );

  const hasWorkerIssues = staleWorkers.length > 0;

  const filteredJobs = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    if (!query) return jobs;

    return jobs.filter((job) => {
      return job.id.toLowerCase().includes(query) || job.job_type.toLowerCase().includes(query);
    });
  }, [jobs, searchText]);

  async function handleRetry(id: string) {
    try {
      setError("");
      setSuccessMessage("");

      const updatedJob = await retryJob(id);

      if (selectedJob?.id === id) {
        setSelectedJob(updatedJob);
      }

      setSuccessMessage(`Task retried: ${updatedJob.job_type}`);
      await loadData(false);
    } catch (err: any) {
      setError(err?.message || "Retry failed");
    }
  }

  function openCancelDialog(job: Job) {
    setConfirmingCancelJob(job);
  }

  function closeCancelDialog() {
    if (cancellingJob) return;
    setConfirmingCancelJob(null);
  }

  async function confirmCancelJob() {
    if (!confirmingCancelJob) return;

    try {
      setError("");
      setSuccessMessage("");
      setCancellingJob(true);

      const updatedJob = await cancelJob(confirmingCancelJob.id);

      if (selectedJob?.id === updatedJob.id) {
        setSelectedJob(updatedJob);
      }

      setSuccessMessage(`Task cancelled: ${updatedJob.job_type}`);
      setConfirmingCancelJob(null);
      await loadData(false);
    } catch (err: any) {
      setError(err?.message || "Cancel failed");
    } finally {
      setCancellingJob(false);
    }
  }

  async function handleSelectJob(id: string) {
    try {
      const job = await fetchJobById(id);
      setSelectedJob(job);
    } catch (err: any) {
      setError(err?.message || "Failed to load task details");
    }
  }

  async function handleCreateJob() {
    try {
      setError("");
      setSuccessMessage("");
      setCreatingJob(true);

      let parsedPayload: Record<string, unknown> = {};

      try {
        parsedPayload = JSON.parse(newPayloadText);
      } catch {
        throw new Error("Payload must be valid JSON");
      }

      const createdJob = await createJob({
        queueName: newQueueName.trim() || "default",
        jobType: newJobType,
        payload: parsedPayload,
        priority: Number(newPriority),
        maxAttempts: Number(newMaxAttempts)
      });

      setNewQueueName("default");
      setNewJobType("flaky_mock");
      setNewPriority(50);
      setNewMaxAttempts(5);
      setNewPayloadText('{\n  "note": "created from dashboard"\n}');
      setSearchText("");
      setSelectedJob(createdJob);
      setSuccessMessage(`Task created: ${createdJob.job_type}`);

      await loadData(false);
    } catch (err: any) {
      setError(err?.message || "Failed to create task");
    } finally {
      setCreatingJob(false);
    }
  }

  function renderWorkerSummary(worker: WorkerHealth) {
    const statusClass =
      worker.health === "healthy"
        ? "health-healthy"
        : worker.health === "stale"
          ? "health-stale"
          : "health-unhealthy";

    return (
      <div key={worker.worker_id} className={`worker-card ${statusClass}`}>
        <div className="worker-top">
          <strong>{worker.worker_id}</strong>
          <span className={`worker-health worker-health-${worker.health}`}>
            {getFriendlyHealthLabel(worker.health)}
          </span>
        </div>

        <div className="worker-meta">
          <span>Current state: {getFriendlyWorkerStatus(worker.status)}</span>
        </div>

        <div className="worker-meta">
          <span>Last heartbeat: {worker.heartbeat_age_seconds}s ago</span>
        </div>

        <div className="worker-meta">
          <span>Started: {new Date(worker.started_at).toLocaleString()}</span>
        </div>

        <div className="worker-meta">
          <span>Last claimed task: {worker.last_claimed_job_id?.slice(0, 8) || "-"}</span>
        </div>

        {worker.last_error ? (
          <div className="worker-error">Last error: {worker.last_error}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <h1>s30-queue Dashboard</h1>
          <p>Monitor background tasks, worker health, retries, and failures.</p>
        </div>

        <div className="topbar-actions">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All tasks</option>
            <option value="pending">Waiting</option>
            <option value="processing">In progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="dead_letter">Needs attention</option>
            <option value="cancelled">Cancelled</option>
          </select>

          <button onClick={() => void loadData(false)} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      <section className="explain-panel">
        <div className="explain-block">
          <h2>What this project does</h2>
          <p>
            This app stores slow tasks in a queue and lets a background worker process them later.
          </p>
        </div>

        <div className="explain-block">
          <h2>How to read this page</h2>
          <p>
            “Task” means one job to be done, “worker” means the background processor, and “needs
            attention” means a task failed too many times.
          </p>
        </div>
      </section>

      <section className="lifecycle-section">
        <div className="section-head">
          <div>
            <h2>How a task moves</h2>
            <p className="section-note">This is the normal journey of one task through the system.</p>
          </div>
        </div>

        <div className="lifecycle-grid">
          {TASK_LIFECYCLE.map((step) => (
            <div key={step.title} className="lifecycle-card">
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="table-section">
        <div className="section-head">
          <div>
            <h2>Create test task</h2>
            <p className="section-note">
              Enqueue a sample background task directly from the dashboard.
            </p>
          </div>
        </div>

        <div className="create-job-grid">
          <div className="form-field">
            <label>Queue name</label>
            <input
              type="text"
              value={newQueueName}
              onChange={(e) => setNewQueueName(e.target.value)}
              placeholder="default"
            />
          </div>

          <div className="form-field">
            <label>Task type</label>
            <select value={newJobType} onChange={(e) => setNewJobType(e.target.value)}>
              <option value="flaky_mock">flaky_mock</option>
              <option value="always_fail_mock">always_fail_mock</option>
              <option value="send_email_mock">send_email_mock</option>
            </select>
          </div>

          <div className="form-field">
            <label>Priority</label>
            <input
              type="number"
              min={0}
              max={100}
              value={newPriority}
              onChange={(e) => setNewPriority(Number(e.target.value))}
            />
          </div>

          <div className="form-field">
            <label>Max attempts</label>
            <input
              type="number"
              min={1}
              max={20}
              value={newMaxAttempts}
              onChange={(e) => setNewMaxAttempts(Number(e.target.value))}
            />
          </div>

          <div className="form-field form-field-full">
            <label>Payload (JSON)</label>
            <textarea
              value={newPayloadText}
              onChange={(e) => setNewPayloadText(e.target.value)}
              rows={8}
            />
          </div>

          <div className="form-actions">
            <button onClick={() => void handleCreateJob()} disabled={creatingJob}>
              {creatingJob ? "Creating..." : "Create task"}
            </button>
          </div>
        </div>
      </section>

      <section className="toolbar">
        <div className="quick-filters">
          {QUICK_FILTERS.map((item) => (
            <button
              key={item.value}
              className={statusFilter === item.value ? "filter-chip active" : "filter-chip"}
              onClick={() => {
                setStatusFilter(item.value);
                setPage(1);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="search-box">
          <input
            type="text"
            placeholder="Search by task ID or type"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        <div className="refresh-meta">
          <span>Auto-refresh: every 5s</span>
          <span>Last updated: {lastUpdated}</span>
        </div>
      </section>

      {hasWorkerIssues ? (
        <div className="warning-banner">
          {staleWorkers.length} worker{staleWorkers.length > 1 ? "s are" : " is"} not fully healthy
        </div>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {successMessage ? <div className="success-banner">{successMessage}</div> : null}

      <section className="cards">
        <div className="card">
          <span className="label">Tasks waiting</span>
          <strong>{stats.queueDepth}</strong>
          <small>Tasks still in line</small>
        </div>

        <div className="card">
          <span className="label">Needs attention</span>
          <strong>{stats.deadLetterCount}</strong>
          <small>Tasks that failed too many times</small>
        </div>

        <div className="card">
          <span className="label">Being retried</span>
          <strong>{stats.retryingCount}</strong>
          <small>Tasks currently in retry flow</small>
        </div>

        <div className="card">
          <span className="label">Oldest waiting task</span>
          <strong>{stats.oldestPendingAgeSeconds}s</strong>
          <small>How long the oldest waiting task has sat in queue</small>
        </div>
      </section>

      <section className="status-summary">
        <div className="section-head">
          <h2>Task status guide</h2>
          <span>{stats.byStatus.length} visible states</span>
        </div>

        <div className="status-pills status-pills-vertical">
          {stats.byStatus.length === 0 ? (
            <span className="muted">No task states to show yet.</span>
          ) : (
            stats.byStatus.map((item) => (
              <div key={item.status} className="status-guide-card">
                <div className="status-guide-top">
                  <span className={`badge badge-${item.status}`}>
                    {getFriendlyStatusLabel(item.status)}
                  </span>
                  <strong>{item.count}</strong>
                </div>
                <p>{getStatusHelpText(item.status)}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="status-summary">
        <div className="section-head">
          <h2>Background processor</h2>
          <span>{workers.length} worker{workers.length !== 1 ? "s" : ""}</span>
        </div>

        {workers.length === 0 ? (
          <span className="muted">No workers registered.</span>
        ) : (
          <div className="worker-grid">{workers.map((worker) => renderWorkerSummary(worker))}</div>
        )}
      </section>

      <section className="table-section">
        <div className="section-head">
          <div>
            <h2>Recent tasks</h2>
            <p className="section-note">
              Latest tasks created in the system. Click a row to inspect details.
            </p>
          </div>
          <span>
            Page {page} of {totalPages}
          </span>
        </div>

        {loading ? (
          <div className="empty-state">Loading dashboard...</div>
        ) : filteredJobs.length === 0 ? (
          <div className="empty-state">No tasks found for this filter/search.</div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Priority</th>
                    <th>Created</th>
                    <th>Last error</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job) => (
                    <tr
                      key={job.id}
                      className="clickable-row"
                      onClick={() => void handleSelectJob(job.id)}
                    >
                      <td className="mono">{job.id.slice(0, 8)}...</td>
                      <td>{job.job_type}</td>
                      <td>
                        <span className={`badge badge-${job.status}`}>
                          {getFriendlyStatusLabel(job.status)}
                        </span>
                      </td>
                      <td>
                        {job.attempts}/{job.max_attempts}
                      </td>
                      <td>{job.priority}</td>
                      <td>{new Date(job.created_at).toLocaleString()}</td>
                      <td className="error-cell">{job.last_error || "-"}</td>
                      <td>
                        {job.status === "pending" ? (
                          <button
                            className="button-danger"
                            onClick={(event) => {
                              event.stopPropagation();
                              openCancelDialog(job);
                            }}
                          >
                            Cancel
                          </button>
                        ) : job.status === "dead_letter" || job.status === "failed" ? (
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleRetry(job.id);
                            }}
                          >
                            Retry
                          </button>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
              >
                Prev
              </button>

              <button
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page === totalPages}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>

      <section className="table-section">
        <div className="section-head">
          <div>
            <h2>Task details</h2>
            <p className="section-note">Use this to inspect one task more deeply.</p>
          </div>
          <span>{selectedJob ? selectedJob.id.slice(0, 8) : "none selected"}</span>
        </div>

        {!selectedJob ? (
          <div className="empty-state">Click a task row to inspect full details.</div>
        ) : (
          <div className="task-details-shell">
            <div className="task-overview-card">
              <div className="task-overview-top">
                <div>
                  <h3 className="task-title">{selectedJob.job_type}</h3>
                  <p className="task-subtitle">{getDerivedTaskMessage(selectedJob)}</p>

                  <div className="task-detail-actions">
                    {selectedJob.status === "pending" ? (
                      <button
                        className="button-danger"
                        onClick={() => openCancelDialog(selectedJob)}
                      >
                        Cancel task
                      </button>
                    ) : selectedJob.status === "failed" || selectedJob.status === "dead_letter" ? (
                      <button onClick={() => void handleRetry(selectedJob.id)}>
                        Retry task
                      </button>
                    ) : null}
                  </div>
                </div>

                <span className={`badge badge-${selectedJob.status}`}>
                  {getFriendlyStatusLabel(selectedJob.status)}
                </span>
              </div>

              <div className="timeline-grid">
                {getTimelineItems(selectedJob).map((item) => (
                  <div
                    key={item.label}
                    className={item.active ? "timeline-card active" : "timeline-card"}
                  >
                    <span className="timeline-label">{item.label}</span>
                    <strong>{item.value ? new Date(item.value).toLocaleString() : "-"}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="detail-grid">
              <div>
                <strong>ID:</strong> <span className="mono">{selectedJob.id}</span>
              </div>
              <div>
                <strong>Queue:</strong> {selectedJob.queue_name}
              </div>
              <div>
                <strong>Type:</strong> {selectedJob.job_type}
              </div>
              <div>
                <strong>Priority:</strong> {selectedJob.priority}
              </div>
              <div>
                <strong>Attempts:</strong> {selectedJob.attempts}/{selectedJob.max_attempts}
              </div>
              <div>
                <strong>Locked by:</strong> {selectedJob.locked_by || "-"}
              </div>
              <div>
                <strong>Run at:</strong> {new Date(selectedJob.run_at).toLocaleString()}
              </div>
              <div>
                <strong>Updated:</strong> {new Date(selectedJob.updated_at).toLocaleString()}
              </div>
              <div className="detail-full">
                <strong>Last error:</strong>
                <div className="info-box error-box">{selectedJob.last_error || "-"}</div>
              </div>
              <div className="detail-full">
                <strong>Payload:</strong>
                <pre className="payload-box">{JSON.stringify(selectedJob.payload, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="table-section">
        <div className="section-head">
          <div>
            <h2>Tasks needing attention</h2>
            <p className="section-note">
              These are the tasks that failed too many times and may need manual review.
            </p>
          </div>
          <span>{deadLetterJobs.length} visible</span>
        </div>

        {deadLetterJobs.length === 0 ? (
          <div className="empty-state">No tasks need attention right now.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Attempts</th>
                  <th>Last error</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {deadLetterJobs.map((job) => (
                  <tr
                    key={job.id}
                    className="clickable-row"
                    onClick={() => void handleSelectJob(job.id)}
                  >
                    <td className="mono">{job.id.slice(0, 8)}...</td>
                    <td>{job.job_type}</td>
                    <td>
                      {job.attempts}/{job.max_attempts}
                    </td>
                    <td className="error-cell">{job.last_error || "-"}</td>
                    <td>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleRetry(job.id);
                        }}
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmingCancelJob ? (
        <div className="modal-backdrop" onClick={closeCancelDialog}>
          <div
            className="modal-card"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h3>Cancel queued task?</h3>
            <p>
              This will stop <span className="mono">{confirmingCancelJob.id.slice(0, 8)}...</span>{" "}
              before a worker picks it up.
            </p>
            <p className="modal-subtext">
              Task type: <strong>{confirmingCancelJob.job_type}</strong>
            </p>

            <div className="modal-actions">
              <button onClick={closeCancelDialog} disabled={cancellingJob}>
                Keep task
              </button>
              <button
                className="button-danger"
                onClick={() => void confirmCancelJob()}
                disabled={cancellingJob}
              >
                {cancellingJob ? "Cancelling..." : "Yes, cancel task"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
