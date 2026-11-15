/**
 * Cashfree Payments (online payments: UPI, cards, netbanking, wallets).
 *
 * .env:
 *   CASHFREE_APP_ID=…            (Cashfree dashboard → Developers → API keys)
 *   CASHFREE_SECRET_KEY=…        (secret: never in the website code or GitHub)
 *   CASHFREE_ENV=sandbox         sandbox = test payments, production = real money
 *
 * Without the two keys, online payment is switched off and only cash on
 * delivery is offered.
 *
 * API: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
 */
const crypto = require("crypto");

const API_VERSION = "2025-01-01";

function cashfreeConfig(env = process.env) {
  const appId = (env.CASHFREE_APP_ID || "").trim();
  const secretKey = (env.CASHFREE_SECRET_KEY || "").trim();
  if (!appId || !secretKey) return null;
  const mode = (env.CASHFREE_ENV || "sandbox").trim() === "production" ? "production" : "sandbox";
  return {
    appId,
    secretKey,
    mode,
    baseUrl: mode === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
  };
}

class CashfreeError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, { body, idempotencyKey } = {}) {
  const config = cashfreeConfig();
  if (!config) throw new CashfreeError("Online payment isn't set up.", 503);

  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-api-version": API_VERSION,
      "x-client-id": config.appId,
      "x-client-secret": config.secretKey,
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CashfreeError(`Cashfree: ${data.message || response.status}`, response.status, data);
  }
  return data;
}

/**
 * Start a payment for one of our orders.
 * @returns {Promise<{ payment_session_id, order_id, cf_order_id, order_status, order_expiry_time }>}
 */
function createOrder({ gatewayOrderId, amount, customer, returnUrl, notifyUrl, expiresAt, note }) {
  return request("POST", "/orders", {
    idempotencyKey: crypto.createHash("sha256").update(gatewayOrderId).digest("hex").slice(0, 32),
    body: {
      order_id: gatewayOrderId,
      order_amount: Number(Number(amount).toFixed(2)),
      order_currency: "INR",
      customer_details: customer,
      order_meta: {
        return_url: returnUrl,
        ...(notifyUrl ? { notify_url: notifyUrl } : {}),
      },
      ...(expiresAt ? { order_expiry_time: expiresAt.toISOString() } : {}),
      ...(note ? { order_note: String(note).slice(0, 200) } : {}),
    },
  });
}

/** All payment attempts for an order (newest first as Cashfree returns them). */
function getPayments(gatewayOrderId) {
  return request("GET", `/orders/${encodeURIComponent(gatewayOrderId)}/payments`);
}

/** Full or part refund. refundId must be unique per refund. */
function createRefund(gatewayOrderId, { refundId, amount, note }) {
  return request("POST", `/orders/${encodeURIComponent(gatewayOrderId)}/refunds`, {
    idempotencyKey: crypto.createHash("sha256").update(refundId).digest("hex").slice(0, 32),
    body: {
      refund_id: refundId,
      refund_amount: Number(Number(amount).toFixed(2)),
      ...(note ? { refund_note: String(note).slice(0, 100) } : {}),
    },
  });
}

/**
 * Is this webhook really from Cashfree? Same check as Cashfree's own SDK
 * (PGVerifyWebhookSignature): base64(HMAC-SHA256(secret, timestamp + rawBody)).
 */
function verifyWebhook(rawBody, timestamp, signature, env = process.env) {
  const config = cashfreeConfig(env);
  if (!config || !rawBody || !timestamp || !signature) return false;
  const expected = crypto.createHmac("sha256", config.secretKey).update(`${timestamp}${rawBody}`).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Customer id Cashfree accepts: 3–50 letters/numbers. */
const customerId = (id) => String(id).replace(/[^A-Za-z0-9]/g, "").slice(0, 50).padEnd(3, "0");

module.exports = { cashfreeConfig, createOrder, getPayments, createRefund, verifyWebhook, customerId, CashfreeError, API_VERSION };
