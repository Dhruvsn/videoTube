import mongoose, { connect } from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async () => {
  try {
    const connectiontInstance = await mongoose.connect(
      `${process.env.MONGODB_URL}/${DB_NAME}`
    );
    console.log(
      `\n MongoDb connected!! DB HOST: ${connectiontInstance.connection.host}`
    );
  } catch (err) {
    console.log("MONGODB connection error:", err.message);
    process.exit(1); // learn it from node docs
  }
};

export { connectDB };
