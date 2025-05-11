import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudnary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import { upload } from "../middlewares/multer.middleware.js";
import { subscribe } from "diagnostics_channel";

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
      $unset: {
        refreshToken: 1, // Remove refresh token from user document
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

const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldpassword, newpassword } = req.body;

  const user = await User.findById(req.user?._id);

  const isPasswordCorrect = await user.isPasswordCorrect(oldpassword);

  if (!isPasswordCorrect) {
    throw new ApiError(400, "Invalid password");
  }

  user.password = newpassword;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "User fetched successfully "));
});

const updateAcccountDetails = asyncHandler(async (req, res) => {
  const { fullName, email } = req.body;

  if (!fullName || !email) {
    throw new ApiError(400, "All fields are required");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullName,
        email: email,
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvator = asyncHandler(async (req, res) => {
  const avatorLocalPath = req.file?.path;

  if (!avatorLocalPath) {
    throw new ApiError(400, "Avator file is missing");
  }
  const avator = await uploadOnCloudinary(avatorLocalPath);
  if (!avator.url) {
    throw new ApiError(400, "Error while uploading on cloudinary");
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        avator: avator.url,
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Avator Image updated successfully"));
});

const updateUserCoverImg = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.file?.path;

  if (!coverImageLocalPath) {
    throw new ApiError(400, "cover Image file is missing");
  }
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);
  if (!coverImage.url) {
    throw new ApiError(400, "Error while uploading on cloudinary");
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        coverImage: coverImage.url,
      },
    },
    { new: true }
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover Image updated successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.params;

  if (!username?.trim()) {
    throw new ApiError(400, "username is Invalid");
  }
  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "Subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "Subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscibedTo",
      },
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers",
        },
        channelsSubscibedToCount: {
          $size: "$subscibedTo",
        },
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $project: {
        fullName: 1,
        username: 1,
        subscribersCount: 1,
        channelsSubscibedToCount: 1,
        isSubscribed: 1,
        avator: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ]);

  console.log(channel);

  if (!channel?.length) {
    throw new ApiError(404, "Channel does not exists");
  }

  return res
    .status(200)
    .ApiResponse(200, channel[0], "User channel fetched successfully");
});

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(req.user?.id),
      },
    },
    {
      $lookup: {
        from: "Video",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipleline: [
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: "owner",
              pipleline: [
                {
                  $project: {
                    fullName: 1,
                    username: 1,
                    avator: 1,
                  },
                },
              ],
            },
          },
          {
            $addFields: {
              owner: {
                $first: "$owner",
              },
            },
          },
        ],
      },
    },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        user[0].watchHistory,
        "Watch History fetched successfully!"
      )
    );
});

//---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  changeCurrentPassword,
  updateAcccountDetails,
  updateUserAvator,
  updateUserCoverImg,
  getUserChannelProfile,
  getWatchHistory,
};
