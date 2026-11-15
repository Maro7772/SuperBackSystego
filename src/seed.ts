import mongoose from "mongoose";
import dotenv from "dotenv";
import { connectDB } from "./models/connection";
import { seedData } from "./utils/seedData";
import { seedAdminFromEnv } from "./utils/seedAdmin";

dotenv.config();

const runSeed = async () => {
  try {
    await connectDB();
    await seedData();
    await seedAdminFromEnv();
    console.log("Seeding complete. Exiting...");
    process.exit(0);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }
};

runSeed();
