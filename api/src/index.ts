import express from "express";
import cors from "cors";
import healthRouter from "./routes/health.js";
import jobsRouter from "./routes/jobs.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/jobs", jobsRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API running on port ${port}`);
});
