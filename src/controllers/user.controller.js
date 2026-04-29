import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Transaction } from "../models/transaction.model.js";

const registerUser = asyncHandler(async (req, res) => {
  // 1. Get user details from frontend (Postman)
  const { fullName, email, username, password } = req.body;

  // 2. Validation - check if fields are not empty
  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }

  // 3. Check if user already exists
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exists");
  }

  // 4. Check for Avatar (Image)
  let avatarUrl = "https://ui-avatars.com/api/?name=" + encodeURIComponent(fullName) + "&background=random";
  const avatarLocalPath = req.files?.avatar?.[0]?.path;

  if (avatarLocalPath) {
    const uploadedAvatar = await uploadOnCloudinary(avatarLocalPath);
    if (!uploadedAvatar) {
      throw new ApiError(400, "Avatar file failed to upload on cloud");
    }
    avatarUrl = uploadedAvatar.url;
  }

  // 6. Create User Object (TradeVerse Specific: walletBalance is 0 by default)
  const user = await User.create({
    fullName,
    avatar: avatarUrl,
    email,
    password,
    username: username.toLowerCase(),
    // walletBalance and portfolio are set to default automatically by your Model
  });

  // 7. Check if user creation worked
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken" // Don't send the password back to the user!
  );

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user");
  }

  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered successfully"));
});

// Helper Function to create access and refresh tokens
const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    // Save the refresh token to the database
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while generating refresh and access token"
    );
  }
};

// Login Controller
const loginUser = asyncHandler(async (req, res) => {
  // 1. Get data from user (Postman)
  const { email, username, password } = req.body;

  if (!username && !email) {
    throw new ApiError(400, "Username or email is required");
  }

  // 2. Find the user in the database
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  // 3. Check if the password matches the hashed password
  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  // 6. Security settings for the Cookies
  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "strict"
  };

  // 7. Send the response WITH the cookies
  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged In Successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  // 1. Remove the refresh token from the database
  await User.findByIdAndUpdate(
    req.user._id, // We have access to req.user because of our Bouncer!
    {
      $unset: {
        refreshToken: 1,
      },
    },
    {
      new: true,
    }
  );

  const options = {
    httpOnly: true,
    secure: true,
    sameSite: "strict"
  };

  // 2. Clear the cookies from the user's browser
  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const addMoneyToWallet = asyncHandler(async (req, res) => {
  // 1. Get the amount the user wants to add from the request body
  const { amount } = req.body;

  // 2. Security check: Make sure it's a valid positive number
  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    throw new ApiError(400, "Please provide a valid positive amount.");
  }

  // 3. Find the user and add the money to their walletBalance
  const updatedUser = await User.findByIdAndUpdate(
    req.user._id, // We know who they are because of the Bouncer!
    {
      $inc: { walletBalance: Number(amount) }, // $inc automatically adds to the existing number
    },
    { new: true } // Return the updated user document
  ).select("-password -refreshToken"); // Don't send back sensitive info

  // --- PRINT RECEIPT ---
  await Transaction.create({
    user: req.user._id,
    type: "DEPOSIT",
    totalAmount: Number(amount),
  });

  // 4. Send the success response
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { walletBalance: updatedUser.walletBalance },
        `Successfully added ₹${amount} to wallet.`
      )
    );
});

export { registerUser, loginUser, logoutUser, addMoneyToWallet };
