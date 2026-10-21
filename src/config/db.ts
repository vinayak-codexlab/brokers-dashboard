import mongoose from "mongoose";
import { env } from "./env.js";

// Read-only service: never build indexes or create collections on startup — both are
// writes, and index changes go through separate DBA review.
mongoose.set("autoIndex", false);
mongoose.set("autoCreate", false);
mongoose.set("strictQuery", true);

export const connectDB = async()=>{
    try{
        await mongoose.connect(env.MONGO_URI, { maxPoolSize: env.MONGO_MAX_POOL_SIZE });
        console.log("DB connected successfully");
    } catch(err){
        console.log("Error in the db connection !",err);
        process.exit(1);
    }
};
