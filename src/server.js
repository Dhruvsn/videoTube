// require("dotenv").config({ path: "./env" });
import dotenv from "dotenv";
import { connectDB } from "./db/db_connect.js";

dotenv.config({
  path: "./env",
});

connectDB();
