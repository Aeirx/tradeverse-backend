import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  buyStock,
  sellStock,
  getPortfolio,
  getHistory,
} from "../controllers/trade.controller.js";

const router = Router();

// Bouncer protects all trade routes!
router.use(verifyJWT);

router.route("/buy").post(buyStock);
router.route("/sell").post(sellStock);
router.route("/portfolio").get(getPortfolio);
router.route("/history").get(getHistory);
export default router;
