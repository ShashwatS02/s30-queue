import {
  claimNextJob,
  markJobCompleted,
  handleJobFailure,
  upsertWorkerHeartbeat
} from "../repositories/jobsRepository.js";
import { recoverStaleProcessingJobs } from "../repositories/recoveryRepository.js";
import { runJob } from "../handlers/index.js";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startPolling() {
  const workerId = process.env.WORKER_ID || "worker-1";

  console.log(`Worker started: ${workerId}`);

  await upsertWorkerHeartbeat({
    workerId,
    status: "idle",
    lastClaimedJobId: null,
    lastError: null
  });

  while (true) {
    try {
      await upsertWorkerHeartbeat({
        workerId,
        status: "polling",
        lastClaimedJobId: null,
        lastError: null
      });

      const recovered = await recoverStaleProcessingJobs({
        staleLockSeconds: 60,
        staleHeartbeatSeconds: 20,
        limit: 10
      });

      if (recovered.length > 0) {
        for (const item of recovered) {
          if (item.action === "retry_scheduled") {
            console.warn(
              `Recovered stale job ${item.id}; retry scheduled in ${item.delaySeconds}s`
            );
          } else {
            console.warn(`Recovered stale job ${item.id}; moved to dead_letter`);
          }
        }
      }

      const job = await claimNextJob(workerId);

      if (!job) {
        await upsertWorkerHeartbeat({
          workerId,
          status: "idle",
          lastClaimedJobId: null,
          lastError: null
        });

        await sleep(3000);
        continue;
      }

      console.log(`Claimed job ${job.id}`);

      await upsertWorkerHeartbeat({
        workerId,
        status: "processing",
        lastClaimedJobId: job.id,
        lastError: null
      });

      try {
        await runJob(job);
        await markJobCompleted(job.id);

        await upsertWorkerHeartbeat({
          workerId,
          status: "idle",
          lastClaimedJobId: job.id,
          lastError: null
        });

        console.log(`Completed job ${job.id}`);
      } catch (handlerError: any) {
        const message = handlerError?.message || "Unknown worker error";
        const failureResult = await handleJobFailure(job, message);

        await upsertWorkerHeartbeat({
          workerId,
          status: "error",
          lastClaimedJobId: job.id,
          lastError: message
        });

        if (failureResult.action === "retry_scheduled") {
          console.error(
            `Retry scheduled for job ${job.id} in ${failureResult.delaySeconds}s`
          );
        } else {
          console.error(`Moved job ${job.id} to dead_letter`);
        }
      }
    } catch (error: any) {
      await upsertWorkerHeartbeat({
        workerId,
        status: "error",
        lastClaimedJobId: null,
        lastError: error?.message || "Worker loop error"
      });

      console.error("Worker loop error:", error);
      await sleep(3000);
    }
  }
}
