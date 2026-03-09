import "dotenv/config";
import express from "express";
import cors from "cors";
import healthRouter from "./routes/health.js";
import jobsRouter from "./routes/jobs.js";
import statsRouter from "./routes/stats.js";
import workersRouter from "./routes/workers.js";

const app = express();

app.use(
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"]
  })
);

app.use(express.json());

app.use("/health", healthRouter);
app.use("/jobs", jobsRouter);
app.use("/queues/stats", statsRouter);
app.use("/workers", workersRouter);

const port = Number(process.env.PORT || 4000);

app.listen(port, () => {
  console.log(`API running on port ${port}`);
});
