import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  addMoneyToWallet,
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
// Secured routes
router.route("/logout").post(verifyJWT, logoutUser);
router.route("/wallet/add").post(verifyJWT, addMoneyToWallet);
export default router;
