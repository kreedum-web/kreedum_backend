require("./src/config/bootstrap");

require("dotenv").config();
const app = require("./src/app");
const connectDatabase = require("./src/config/database");
const ensureCartIndexes = require("./src/utils/ensureCartIndexes");
const ensureUserIndexes = require("./src/utils/ensureUserIndexes");
const { phoneProvider } = require("./src/utils/phoneAuth");
const { transportName } = require("./src/utils/mailer");

const PORT = process.env.PORT || 5000;

// console.log(":", process.env.MONGODB_URI);

async function startServer() {
  await connectDatabase();
  await ensureCartIndexes();
  await ensureUserIndexes();

  app.listen(PORT, () => {
    console.log(`🚀 Kreedum API running on port ${PORT}`);
    // Which way emails go out (see src/utils/mailer.js).
    const mail = transportName();
    console.log(
      mail === "log"
        ? "📧 Email: not configured — codes and order emails are only printed here"
        : `📧 Email: ${mail}`
    );
    // Phone sign-in (see src/utils/phoneAuth.js).
    const phone = phoneProvider();
    console.log(phone ? `📱 Phone sign-in: ${phone}` : "📱 Phone sign-in: off (no Firebase or SMS settings)");
  });
}

startServer();