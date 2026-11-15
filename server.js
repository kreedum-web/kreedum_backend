require("./src/config/bootstrap");

require("dotenv").config();
const app = require("./src/app");
const connectDatabase = require("./src/config/database");
const ensureCartIndexes = require("./src/utils/ensureCartIndexes");
const ensureUserIndexes = require("./src/utils/ensureUserIndexes");
const { phoneProvider } = require("./src/utils/phoneAuth");
const { cashfreeConfig } = require("./src/utils/cashfree");
const { expireUnpaidOrders } = require("./src/services/paymentService");
const { transportName } = require("./src/utils/mailer");

const PORT = process.env.PORT || 5000;

// console.log(":", process.env.MONGODB_URI);

async function startServer() {
  await connectDatabase();
  await ensureCartIndexes();
  await ensureUserIndexes();

  // Every 10 minutes: cancel online orders that weren't paid within the hour.
  setInterval(() => {
    expireUnpaidOrders().catch((error) => console.error("Expiring unpaid orders failed:", error.message));
  }, 10 * 60 * 1000).unref();

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
    // Online payments (src/utils/cashfree.js).
    const payments = cashfreeConfig();
    console.log(
      payments
        ? `💳 Online payments: Cashfree ${payments.mode}${payments.mode === "sandbox" ? " (test money)" : " (REAL money)"}`
        : "💳 Online payments: off (no Cashfree keys), cash on delivery only"
    );
  });
}

startServer();