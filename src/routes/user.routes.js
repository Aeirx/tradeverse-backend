import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  addMoneyToWallet,
  refreshAccessToken,
} from "../controllers/user.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";

const router = Router();

router.route("/register").post(
  upload.fields([
    {
      name: "avatar",
      maxCount: 1,
    },
  ]),
  registerUser
);

router.route("/login").post(loginUser);
router.route("/refresh-token").post(refreshAccessToken);

// Secured routes
router.route("/logout").post(verifyJWT, logoutUser);
router.route("/wallet/add").post(verifyJWT, addMoneyToWallet);
router.route("/balance").get(verifyJWT, (req, res) => {
  // This endpoint is for the React UI to fetch the user's current wallet balance and portfolio
  res.status(200).json({
    walletBalance: req.user?.walletBalance || 100000,
    portfolio: req.user?.portfolio || [],
  });
});
export default router;
