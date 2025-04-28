import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/apiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudnary.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const registerUser = asyncHandler(async (req, res) => {
  // get user details from frontend
  const { fullName, email, username, password } = req.body;
  console.log("email: ", email);
  // validation  - not empty
  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }
  //  check if user already exists : username,email
  const existedUser = User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(409, "User with email or username already exists");
  }
  //  check for images , check for avator
  const avatorLocalPath = req.files?.avator[0]?.path;
  const coverImageLocalPath = req.files?.coverImage[0]?.path;
  if (!avatorLocalPath) {
    throw new ApiError(400, "Avator file is required");
  }

  //  upload them to cloudinary , avator
  const avator = await uploadOnCloudinary(avatorLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);
  if (!avator || !coverImage) {
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
  }
  // return response
  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered Succesfully"));
});

//--------------------------------------------------------------------------------------------
export { registerUser };
