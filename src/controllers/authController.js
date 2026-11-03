const authService = require("../services/authService");
const { googleClientId } = require("../utils/googleAuth");
const { phoneProvider, firebaseWebConfig } = require("../utils/phoneAuth");

/** Errors with a status (HttpError) keep it and tell the website what happened via `code`. */
function sendError(res, error, fallbackStatus = 400) {
  return res.status(error.status || fallbackStatus).json({
    success: false,
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.extra || {}),
  });
}

/** Wrap a service call: 200 with its result, or the error as JSON. */
const handle = (run, message, status = 200) => async (req, res) => {
  try {
    const data = await run(req);
    return res.status(status).json({ success: true, message: typeof message === "function" ? message(data) : message, data });
  } catch (error) {
    return sendError(res, error);
  }
};

const welcome = (data) => (data?.isNew ? "Welcome to Kreedum Sports!" : "Signed in.");

class AuthController {
  // GET /auth/options: which sign-in options the website shows
  options = (req, res) =>
    res.status(200).json({
      success: true,
      data: {
        googleClientId: googleClientId() || null,
        // null: mobile numbers hidden · "firebase": website uses Firebase · "sms": our own SMS
        phone: phoneProvider(),
        firebase: phoneProvider() === "firebase" ? firebaseWebConfig() : null,
      },
    });

  // POST /auth/identify { identifier }: new or existing customer?
  identify = handle((req) => authService.identify(req.body.identifier), "OK");

  // POST /auth/login { identifier | email, password }
  login = handle((req) => authService.login(req.body.identifier ?? req.body.email, req.body.password), "Signed in.");

  // POST /auth/register { email, password }: emails a code
  register = handle(
    (req) => authService.register(req.body),
    "We've sent a 6-digit code to your email. Enter it to finish creating your account.",
    201
  );

  // POST /auth/verify-email { email, code }: finishes an email sign-up
  verifyEmail = handle((req) => authService.verifyEmail(req.body.email, req.body.code), welcome);

  // POST /auth/resend-code { email }
  resendCode = handle(
    (req) => authService.resendVerificationCode(req.body.email),
    "If your account is waiting for verification, a new code is on its way."
  );

  // POST /auth/register-phone { idToken | phone+code, password }
  registerPhone = handle((req) => authService.registerPhone(req.body), welcome, 201);

  // POST /auth/phone/start { phone }: own SMS provider only
  startPhoneCode = handle((req) => authService.startPhoneCode(req.body.phone), "We've sent a 6-digit code by SMS.");

  // POST /auth/forgot-password { email }
  forgotPassword = handle(
    (req) => authService.forgotPassword(req.body.email),
    "If an account exists for this email, we've sent a 6-digit code to it."
  );

  // POST /auth/reset-password { email, code, password }
  resetPassword = handle(
    (req) => authService.resetPassword(req.body.email, req.body.code, req.body.password),
    "Your password has been saved."
  );

  // POST /auth/reset-password-phone { idToken | phone+code, password }
  resetPasswordWithPhone = handle((req) => authService.resetPasswordWithPhone(req.body), "Your password has been saved.");

  // POST /auth/google { credential }
  googleLogin = handle((req) => authService.googleLogin(req.body.credential), welcome);

  // GET /auth/me
  getProfile = handle((req) => authService.getProfile(req.user._id), "Profile fetched successfully.");

  // PUT /auth/profile
  updateProfile = handle((req) => authService.updateProfile(req.user._id, req.body), "Profile updated successfully.");

  // PUT /auth/password { currentPassword?, newPassword, confirmPassword? }
  changePassword = handle((req) => authService.changePassword(req.user._id, req.body), "Password saved.");
}

module.exports = new AuthController();
