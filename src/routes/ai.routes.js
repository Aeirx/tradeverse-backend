import { Router } from "express";
import { getAiInsight } from "../controllers/ai.controller.js";

const router = Router();

// This will be triggered when someone hits POST /api/v1/ai/ask
router.route("/ask").post(getAiInsight);

export default router;
