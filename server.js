require("./src/config/bootstrap");

require("dotenv").config();
const app = require("./src/app");
const connectDatabase = require("./src/config/database");

const PORT = process.env.PORT || 5000;

// console.log(":", process.env.MONGODB_URI);

async function startServer() {
  await connectDatabase();

  app.listen(PORT, () => {
    console.log(`🚀 Kreedum API running on port ${PORT}`);
  });
}

startServer();