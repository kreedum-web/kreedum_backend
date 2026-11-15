const paymentService = require("../services/paymentService");

function sendError(res, error) {
  return res.status(error.status && error.status < 600 ? error.status : 400).json({
    success: false,
    message: error.message,
    ...(error.code && typeof error.code === "string" ? { code: error.code } : {}),
  });
}

class PaymentController {
  // GET /payments/options: is online payment on, and in which mode
  options = (req, res) => res.status(200).json({ success: true, data: paymentService.options() });

  // POST /payments/orders/:orderId/start → { paymentSessionId, mode, … }
  start = async (req, res) => {
    try {
      const data = await paymentService.startPayment(req.user._id, req.params.orderId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error.body) console.error("Cashfree start failed:", error.message, JSON.stringify(error.body));
      return sendError(res, error.body ? Object.assign(error, { status: 502, message: "Couldn't start the payment. Please try again in a minute." }) : error);
    }
  };

  // GET /payments/orders/:orderId/status
  status = async (req, res) => {
    try {
      const data = await paymentService.paymentStatus(req.user._id, req.params.orderId);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  };

  // POST /payments/cashfree/webhook (called by Cashfree, not the website)
  webhook = async (req, res) => {
    try {
      const ok = await paymentService.handleWebhook(req.rawBody || "", req.headers);
      if (!ok) return res.status(401).json({ success: false, message: "Invalid signature." });
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Cashfree webhook failed:", error.message);
      // 500 → Cashfree retries later.
      return res.status(500).json({ success: false });
    }
  };
}

module.exports = new PaymentController();
