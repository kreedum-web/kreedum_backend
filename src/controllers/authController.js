const authService = require("../services/authService");
const { googleClientId } = require("../utils/googleAuth");
const { phoneProvider, firebaseWebConfig } = require("../utils/phoneAuth");

/** Errors with a status (HttpError) keep it and tell the website what happened via `code`. */
function sendError(res, error, fallbackStatus) {
  return res.status(error.status || fallbackStatus).json({
    success: false,
    message: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.extra || {}),
  });
}

class AuthController {

  // GET /auth/options: which sign-in buttons the website shows
  async options(req, res) {
    return res.status(200).json({
      success: true,
      data: {
        googleClientId: googleClientId() || null,
        emailCode: true,
        // null: phone sign-in hidden · "firebase": website uses Firebase · "sms": our own SMS
        phone: phoneProvider(),
        firebase: phoneProvider() === "firebase" ? firebaseWebConfig() : null,
      },
    });
  }

  // POST /auth/email/start { email }: email a sign-in code
  async startEmailLogin(req, res) {
    try {
      const result = await authService.startEmailLogin(req.body.email);
      return res.status(200).json({ success: true, message: "We've sent a 6-digit code to your email.", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/email/verify { email, code }: sign in (creates the account the first time)
  async verifyEmailLogin(req, res) {
    try {
      const result = await authService.verifyEmailLogin(req.body.email, req.body.code);
      return res.status(200).json({ success: true, message: result.isNew ? "Welcome to Kreedum Sports!" : "Signed in.", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/phone/firebase { idToken }: phone verified by Firebase
  async firebasePhoneLogin(req, res) {
    try {
      const result = await authService.firebasePhoneLogin(req.body.idToken);
      return res.status(200).json({ success: true, message: result.isNew ? "Welcome to Kreedum Sports!" : "Signed in.", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/phone/start { phone }: SMS a code (own SMS provider)
  async startPhoneLogin(req, res) {
    try {
      const result = await authService.startPhoneLogin(req.body.phone);
      return res.status(200).json({ success: true, message: "We've sent a 6-digit code by SMS.", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/phone/verify { phone, code }
  async verifyPhoneLogin(req, res) {
    try {
      const result = await authService.verifyPhoneLogin(req.body.phone, req.body.code);
      return res.status(200).json({ success: true, message: result.isNew ? "Welcome to Kreedum Sports!" : "Signed in.", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/google { credential }: Continue with Google
  async googleLogin(req, res) {
    try {
      const result = await authService.googleLogin(req.body.credential);
      return res.status(200).json({ success: true, message: result.isNew ? "Welcome to Kreedum Sports!" : "Signed in.", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // ----------------------------
  // Register Customer
  // ----------------------------
  async register(req, res) {
    try {
      const result = await authService.register(req.body);

      return res.status(201).json({
        success: true,
        message: "We've sent a 6-digit code to your email. Enter it to finish creating your account.",
        data: result,
      });

    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // ----------------------------
  // Login Customer
  // ----------------------------
  async login(req, res) {
    try {
      const { email, password } = req.body;

      const result = await authService.login(email, password);

      return res.status(200).json({
        success: true,
        message: "Login successful.",
        data: result,
      });

    } catch (error) {
      return sendError(res, error, 401);
    }
  }

  // POST /auth/verify-email { email, code }
  async verifyEmail(req, res) {
    try {
      const result = await authService.verifyEmail(req.body.email, req.body.code);
      return res.status(200).json({ success: true, message: "Email verified. Welcome to Kreedum Sports!", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/resend-code { email }
  async resendCode(req, res) {
    try {
      await authService.resendVerificationCode(req.body.email);
      return res.status(200).json({ success: true, message: "If your account is waiting for verification, a new code is on its way." });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/forgot-password { email }
  async forgotPassword(req, res) {
    try {
      await authService.forgotPassword(req.body.email);
      return res.status(200).json({ success: true, message: "If an account exists for this email, we've sent a 6-digit code to it." });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // POST /auth/reset-password { email, code, password }
  async resetPassword(req, res) {
    try {
      const result = await authService.resetPassword(req.body.email, req.body.code, req.body.password);
      return res.status(200).json({ success: true, message: "Your password has been changed.", data: result });
    } catch (error) {
      return sendError(res, error, 400);
    }
  }

  // ----------------------------
  // Logged-in User Profile
  // ----------------------------
  async getProfile(req, res) {
    try {
      const profile = await authService.getProfile(req.user._id);

      return res.status(200).json({
        success: true,
        message: "Profile fetched successfully.",
        data: profile,
      });

    } catch (error) {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }
  }

  // ----------------------------
  // Update Profile
  // ----------------------------
  async updateProfile(req, res) {
    try {
      const profile = await authService.updateProfile(
        req.user._id,
        req.body
      );

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully.",
        data: profile,
      });

    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
  }
}

module.exports = new AuthController();