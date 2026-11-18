/**
 * Give an existing store account access to the admin dashboard (or take it away).
 *
 *   npm run admin:make -- owner@example.com          make admin
 *   npm run admin:make -- 9876543210                 (accounts made with a phone number)
 *   npm run admin:make -- owner@example.com --remove back to a normal customer
 *
 * The account must already exist: sign up on the store first, with a password.
 * Uses the database in .env (MONGODB_URI / DB_NAME).
 */
require("../config/bootstrap");
require("dotenv").config();

const mongoose = require("mongoose");
const connectDatabase = require("../config/database");
const User = require("../models/User");

async function main() {
  const login = String(process.argv[2] || "").trim().toLowerCase();
  const remove = process.argv.includes("--remove");
  if (!login || login.startsWith("--")) {
    console.log("Usage: npm run admin:make -- owner@example.com [--remove]");
    process.exit(1);
  }

  await connectDatabase();
  const phone = login.replace(/\D/g, "").slice(-10);
  const user = await User.findOne(login.includes("@") ? { email: login } : { phone, phoneVerified: true });
  if (!user) {
    console.log(`❌ No account found for ${login}. Sign up on the store with it first.`);
  } else {
    user.role = remove ? "customer" : "admin";
    await user.save();
    console.log(remove ? `✅ ${login} is a normal customer again.` : `✅ ${login} can now sign in to the admin dashboard.`);
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("❌", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
