import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";
import { User } from "../models/user.model.js";

export const verifyJWT = asyncHandler(async (req, _, next) => {
  try {
    // 1. Get the token from the cookies (or from mobile app headers)
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(401, "Unauthorized request: No token found");
    }

    // 2. Verify if the token was signed by OUR server
    const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);

    // 3. Find the user in the database using the ID inside the token
    const user = await User.findById(decodedToken?._id).select(
      "-password -refreshToken"
    );

    if (!user) {
      throw new ApiError(401, "Invalid Access Token");
    }

    // 4. Attach the user object to the request so the next function can use it
    req.user = user;
    next(); // Tell the Bouncer to open the door!
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid access token");
  }
});
