const mongoose = require("mongoose");

// Production uses KreedumCommerce. The development server (Render) sets
// DB_NAME=KreedumCommerce_dev so test sign-ups and orders never mix with
// real customers. Same MongoDB cluster, separate database.
const PRODUCTION_DB = "KreedumCommerce";
const databaseName = () => (process.env.DB_NAME || PRODUCTION_DB).trim();

async function connectDatabase() {
  const dbName = databaseName();
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      dbName,
      serverSelectionTimeoutMS: 15000,
    });

    console.log(`✅ MongoDB connected: ${dbName}`);
  } catch (error) {
    console.error(`❌ Database connection failed (${dbName})`);
    console.error(error);
    process.exit(1);
  }
}

module.exports = connectDatabase;
module.exports.databaseName = databaseName;
module.exports.PRODUCTION_DB = PRODUCTION_DB;
