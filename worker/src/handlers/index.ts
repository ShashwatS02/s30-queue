function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runJob(job: any) {
  console.log(`Running job ${job.id} of type ${job.job_type}`);

  if (job.job_type === "send_email_mock") {
    await sleep(2000);
    console.log(`Mock email sent to ${job.payload?.to ?? "unknown"}`);
    return;
  }

  if (job.job_type === "generate_report_mock") {
    await sleep(3000);
    console.log("Mock report generated");
    return;
  }

  if (job.job_type === "webhook_delivery_mock") {
    await sleep(1500);
    console.log("Mock webhook delivered");
    return;
  }

  if (job.job_type === "always_fail_mock") {
    await sleep(1000);
    throw new Error("Intentional permanent failure for testing");
  }

  if (job.job_type === "flaky_mock") {
    await sleep(1000);

    const shouldFail = Number(job.attempts) < 2;
    if (shouldFail) {
      throw new Error(`Transient failure on attempt ${Number(job.attempts) + 1}`);
    }

    console.log("Flaky job finally succeeded");
    return;
  }

  throw new Error(`Unknown job type: ${job.job_type}`);
}
