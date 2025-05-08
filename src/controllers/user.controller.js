import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudnary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefereshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();
    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (err) {
    throw new ApiError(
      500,
      "something went wrong while generating refresh and access token"
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // get user details from frontend
  const { fullName, email, username, password } = req.body;
  console.log("req body ", req.body);
  // validation  - not empty
  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }
  //  check if user already exists : username,email
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exists");
  }
  console.log(req.files);

  //  check for images , check for avator
  const avatorLocalPath = req.files?.avator[0]?.path;
  // const coverImageLocalPath = req.files?.coverImage[0]?.path;
  let coverImageLocalPath;
  if (
    req.files &&
    Array.isArray(req.files.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }
  if (!avatorLocalPath) {
    throw new ApiError(400, "Avator file is required");
  }

  //  upload them to cloudinary , avator
  const avator = await uploadOnCloudinary(avatorLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);
  if (!avator) {
    throw new ApiError(400, "Avator and coverImage file is required");
  }
  // create user object - create entry in db
  const user = await User.create({
    fullName,
    avator: avator.url,
    coverImage: coverImage?.url || "",
    email,
    password,
    username: username.toLowerCase(),
  });
  // remove password and refresh token field from response
  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );
  //  check for user creation
  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user ");
  } else {
    console.log(`user id created:${createdUser}`);
  }

  // return response
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered Succesfully"));
});

/**
 * Handles user login process including validation, authentication,
 * and token generation. Returns user data and sets secure HTTP-only cookies.
 */

const loginUser = asyncHandler(async (req, res) => {
  // Extract login credentials from request body
  const { email, username, password } = req.body;

  // // Validate that either username or email is provided
  if (!username && !email) {
    throw new ApiError(400, "Username or email is required");
  }
  // Find user by username or email in database
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(400, "User does not exist");
  }

  // Verify provided password against stored hashed password
  const ispasswordValid = await user.isPasswordCorrect(password);
  if (!ispasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  // Generate new access and refresh tokens
  const { accessToken, refreshToken } = await generateAccessAndRefereshTokens(
    user._id
  );

  //Get user document without sensitive fields for response
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );
  //Configure secure cookie options
  const options = {
    httpOnly: true,
    secure: true,
  };
  //Return success response with cookies and user data
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
        "user logged in Successfully"
      )
    );
});

//------------------------------------------------------------------------------------------------------------------------------
/**
 * Handles user logout by invalidating refresh token and clearing auth cookies
 * Secure logout process that prevents token reuse
 */
const logoutUser = asyncHandler(async (req, res) => {
  // STEP 1: Invalidate the refresh token in database
  await User.findByIdAndUpdate(
    req.user._id, // Get user ID from authenticated request
    {
      $set: {
        refreshToken: undefined, // Remove refresh token from user document
      },
    },
    {
      new: true, // Return the modified document (though not used here)
    }
  );

  // STEP 2: Configure cookie clearing options
  const options = {
    httpOnly: true, // Prevent client-side JavaScript access
    secure: true, // Only transmit over HTTPS
    // Note: SameSite and other security options could be added here
  };

  // STEP 3: Clear cookies and send response
  return (
    res
      .status(200)
      // Clear access token cookie
      .clearCookie("accessToken", options)
      // Clear refresh token cookie
      .clearCookie("refreshToken", options)
      // Send success response
      .json(
        new ApiResponse(
          200,
          {}, // Empty data payload
          "User logged out successfully"
        )
      )
  );
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incommingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;
  if (!incommingRefreshToken) {
    throw new ApiError(401, "unauthorized request");
  }

  if (incommingRefreshToken !== user?.refreshToken) {
    throw new ApiError(401, "Refresh token is expired or used");
  }

  try {
    const decodedToken = jwt.verify(
      incommingRefreshToken,
      process.env.ACCESS_TOKEN_SECRET
    );
    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, "Invalid refresh Token");
    }

    if (incommingRefreshToken !== user?.refreshToken) {
      throw new ApiError(401, "Refresh token is expired or used");
    }

    const options = {
      httpOnly: true,
      secure: true,
    };
    const { accessToken, newRefreshToken } =
      await generateAccessAndRefereshTokens(user._id);
    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options)
      .json(
        new ApiResponse(
          200,
          { accessToken, newRefreshToken },
          "Acess token refreshed"
        )
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});


//--------------------------------------------------------------------------------------------
export { registerUser, loginUser, logoutUser, refreshAccessToken };
