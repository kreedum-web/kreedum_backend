/**
 * One-time setup for sending through the Gmail API: lets the Kreedum Gmail
 * account give this backend permission to send email, and prints the
 * GMAIL_REFRESH_TOKEN to put in .env (locally and on Render).
 *
 *   1. Put GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env
 *      (Google Cloud → APIs & Services → Credentials → OAuth client, type "Desktop app")
 *   2. npm run gmail:token
 *   3. Open the link it prints, sign in with the Kreedum Gmail account, allow.
 *
 * Only asks for permission to SEND email (gmail.send), not to read the inbox.
 */
require("dotenv").config();

const http = require("http");

const PORT = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

const { GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error("❌ Put GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env first (see the comment at the top of this file).");
  process.exit(1);
}

const consentUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // always return a refresh token
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (!code && !error) {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });

  if (error) {
    res.end(`<p>Permission not given (${error}). You can close this tab.</p>`);
    console.error(`❌ Google said: ${error}`);
    server.close();
    return;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT,
        grant_type: "authorization_code",
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.refresh_token) {
      throw new Error(data.error_description || data.error || "Google returned no refresh token");
    }

    res.end("<p>✅ Done. Go back to the terminal. You can close this tab.</p>");
    console.log("\n✅ Add this line to .env (and to Render → Environment):\n");
    console.log(`GMAIL_REFRESH_TOKEN=${data.refresh_token}\n`);
    console.log("Keep it secret like a password. Then restart the backend.");
  } catch (err) {
    res.end(`<p>Something went wrong: ${err.message}. Check the terminal.</p>`);
    console.error(`❌ ${err.message}`);
  } finally {
    server.close();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this link in your browser and sign in with the Kreedum Gmail account:\n");
  console.log(consentUrl + "\n");
  console.log(`Waiting for Google on ${REDIRECT} …`);
});
