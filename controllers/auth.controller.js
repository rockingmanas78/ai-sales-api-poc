import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { generateTokens } from "../utils/generateTokens.js";
import crypto from "crypto";
import nodemailer from "nodemailer";
import {
  getGoogleAuthUrl,
  handleGoogleLogin,
} from "../services/auth.service.js";

const stateStore = new Map();
const prisma = new PrismaClient();

export const signup = async (req, res) => {
  try {
    const { email, password, tenantId } = req.body;
    if (!tenantId)
      return res.status(400).json({ message: "tenantId is required" });

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser)
      return res.status(400).json({ message: "User already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        tenantId,
      },
    });

    const token = generateTokens(user);
    const { passwordHash, ...userWithoutPassword } = user;

    res.status(201).json({ user: userWithoutPassword, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(401)
        .json({ message: "Email and password are required" });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash)
      return res.status(401).json({ message: "Invalid email or password" });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid email or password" });

    const token = generateTokens(user);
    const { passwordHash, ...userWithoutPassword } = user;

    res.status(200).json({ user: userWithoutPassword, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /auth/google/url
 * Generate Google OAuth URL with state
 */
export const getGoogleLoginUrl = (req, res) => {
  const state = crypto.randomUUID();
  stateStore.set(state, Date.now());
  const url = getGoogleAuthUrl(state);

  res.json({ url }); // send JSON
};

/**
 * GET /auth/google/callback
 * Handle Google redirect with code
 */
export const googleCallback = async (req, res) => {
  try {
    // Support both GET (query) and POST (body)
    const code = req.method === "POST" ? req.body.code : req.query.code;
    const state = req.method === "POST" ? req.body.state : req.query.state;

    console.log(
      `[GoogleAuth] googleCallback called with code: ${code}, state: ${state}, method: ${req.method}`
    );

    // Verify state
    if (!state || !stateStore.has(state)) {
      return res.status(400).send("Invalid or missing state");
    }
    stateStore.delete(state); // remove used state

    // Exchange code for tokens and get user
    const result = await handleGoogleLogin(code);

    if (req.method === "POST") {
      // For API clients, respond with JSON
      return res.json(result);
    } else {
      // For browser GET, redirect to frontend
      return res.redirect(`${process.env.FRONTEND_URL}/?token=${result.token}`);
    }
  } catch (err) {
    console.error("[GoogleAuth] Callback error:", err);
    res.status(500).send("Google login failed");
  }
};

export const refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ message: "Refresh token is required" });

    jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET,
      async (err, decoded) => {
        if (err)
          return res
            .status(403)
            .json({ message: "Invalid or expired refresh token" });

        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
        });
        if (!user) return res.status(404).json({ message: "User not found" });

        const { accessToken, refreshToken: newRefreshToken } =
          generateTokens(user);
        res.status(200).json({ accessToken, refreshToken: newRefreshToken });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const requestReset = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) return res.status(404).json({ message: "User not found" });

    const resetToken = crypto.randomBytes(20).toString("hex");
    const resetTokenExpiration = Date.now() + 3600000;

    await prisma.user.update({
      where: { email },
      data: {
        resetToken,
        resetTokenExpiration,
      },
    });

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Password Reset Request",
      html: `<p>Click the link below to reset your password:</p><p><a href="${resetLink}">Reset Password</a></p>`,
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Password reset link sent to email" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    const user = await prisma.user.findFirst({ where: { resetToken } });

    if (!user || user.resetTokenExpiration < Date.now()) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset token" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashedPassword,
        resetToken: null,
        resetTokenExpiration: null,
      },
    });

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const abc = async (req, res) => {
  console.log("hiii");
  res.status(200).json({ message: "Password reset successfully" });
};
