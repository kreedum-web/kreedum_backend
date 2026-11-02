// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const mailer = require("../src/utils/mailer");

const MAIL = { to: "asha@gmail.com", subject: "₹ 482913 is your code", html: "<p>Hi</p>", text: "Hi 482913" };
const KEYS = ["MAIL_TRANSPORT", "RESEND_API_KEY", "GMAIL_USER", "GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "SMTP_USER", "SMTP_PASS", "MAIL_FROM"];

function withEnv(values, fn) {
  return async () => {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
    Object.assign(process.env, values);
    mailer.setTestTransport(null);
    mailer.resetGmailToken();
    const realFetch = global.fetch;
    try {
      await fn();
    } finally {
      global.fetch = realFetch;
      KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
    }
  };
}

/** Records requests; answers from `routes` by URL. */
function fakeFetch(routes) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const [status, body] = routes(url, calls);
    return { ok: status < 400, status, json: async () => body };
  };
  return calls;
}

const GMAIL = { GMAIL_USER: "kreedumsports@gmail.com", GMAIL_CLIENT_ID: "cid", GMAIL_CLIENT_SECRET: "secret", GMAIL_REFRESH_TOKEN: "refresh" };

test("which way emails go out is chosen by .env", () => {
  assert.equal(mailer.transportName({}), "log");
  assert.equal(mailer.transportName({ SMTP_USER: "a@gmail.com", SMTP_PASS: "x" }), "smtp");
  assert.equal(mailer.transportName({ ...GMAIL, SMTP_USER: "a@gmail.com", SMTP_PASS: "x" }), "gmail-api");
  assert.equal(mailer.transportName({ ...GMAIL, RESEND_API_KEY: "re_1" }), "resend");
  assert.equal(mailer.transportName({ RESEND_API_KEY: "re_1", MAIL_TRANSPORT: "smtp" }), "smtp");
  assert.equal(mailer.fromAddress(GMAIL), "Kreedum Sports <kreedumsports@gmail.com>");
});

test(
  "Gmail API: signs in with the refresh token, sends the email over HTTPS, reuses the sign-in",
  withEnv(GMAIL, async () => {
    const calls = fakeFetch((url) =>
      url.includes("oauth2") ? [200, { access_token: "tok-1", expires_in: 3600 }] : [200, { id: "gmail-msg-1" }]
    );

    const result = await mailer.sendMail(MAIL);
    assert.deepEqual(result, { sent: true, via: "gmail-api", messageId: "gmail-msg-1" });

    const tokenBody = new URLSearchParams(calls[0].options.body);
    assert.equal(tokenBody.get("refresh_token"), "refresh");
    assert.equal(tokenBody.get("grant_type"), "refresh_token");

    assert.equal(calls[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(calls[1].options.headers.authorization, "Bearer tok-1");
    const raw = Buffer.from(JSON.parse(calls[1].options.body).raw, "base64url").toString("utf8");
    assert.match(raw, /^From: Kreedum Sports <kreedumsports@gmail\.com>/m);
    assert.match(raw, /^To: asha@gmail\.com/m);
    assert.match(raw, /^Subject: =\?UTF-8\?/m); // ₹ encoded properly

    await mailer.sendMail(MAIL);
    assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1); // sign-in reused
  })
);

test(
  "Gmail API: an expired / revoked refresh token gives a clear fix",
  withEnv(GMAIL, async () => {
    fakeFetch(() => [400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }]);
    await assert.rejects(mailer.sendMail(MAIL), /Gmail sign-in failed: Token has been expired or revoked\. Run npm run gmail:token again/);
  })
);

test(
  "Gmail API: a rejected sign-in is renewed on the next email",
  withEnv(GMAIL, async () => {
    let send = 0;
    const calls = fakeFetch((url) => {
      if (url.includes("oauth2")) return [200, { access_token: `tok-${calls.length}`, expires_in: 3600 }];
      send++;
      return send === 1 ? [401, { error: { message: "Invalid Credentials" } }] : [200, { id: "ok" }];
    });
    await assert.rejects(mailer.sendMail(MAIL), /Gmail API: Invalid Credentials/);
    assert.equal((await mailer.sendMail(MAIL)).messageId, "ok");
    assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 2);
  })
);

test(
  "Resend (with your own domain): one HTTPS request",
  withEnv({ RESEND_API_KEY: "re_123", MAIL_FROM: "Kreedum Sports <orders@kreedum.in>" }, async () => {
    const calls = fakeFetch(() => [200, { id: "resend-1" }]);
    const result = await mailer.sendMail(MAIL);
    assert.deepEqual(result, { sent: true, via: "resend", messageId: "resend-1" });
    assert.equal(calls[0].url, "https://api.resend.com/emails");
    assert.equal(calls[0].options.headers.authorization, "Bearer re_123");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      from: "Kreedum Sports <orders@kreedum.in>",
      to: ["asha@gmail.com"],
      subject: MAIL.subject,
      html: MAIL.html,
      text: MAIL.text,
    });
  })
);
