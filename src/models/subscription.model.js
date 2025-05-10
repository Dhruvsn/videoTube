import mongoose, { Schema } from "mongoose";

const subscriptionSchema = mongoose.Schema(
  {
    subscriber: {
      type: Schema.Types.ObjectId, // one who is subscribing.
      ref: "User",
    },
    channel: {
      type: Schema.Types.ObjectId, // one to whom 'subscriber'
      ref: "User",
    },
  },
  { timestamps: true }
);

export const Subscription = mongoose.model("Subscription", subscriptionSchema);
