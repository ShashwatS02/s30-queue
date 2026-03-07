import { Router } from "express";

const router = Router();

router.post("/", async (req, res) => {
  res.status(201).json({
    message: "enqueue route placeholder",
    body: req.body
  });
});

router.get("/", async (_req, res) => {
  res.json({
    items: [],
    total: 0
  });
});

export default router;
