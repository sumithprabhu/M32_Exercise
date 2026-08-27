import { Router } from "express";
import { z } from "zod";
import { buildAuthorizationUrl, exchangeCodeForTokens } from "../auth/oauth.service.js";

export const authRouter = Router();

const callbackQuerySchema = z.object({
  code: z.string().min(1, "Missing OAuth 'code' query parameter"),
});

authRouter.get("/install", (_req, res) => {
  res.redirect(buildAuthorizationUrl());
});

authRouter.get("/callback", async (req, res, next) => {
  try {
    const { code } = callbackQuerySchema.parse(req.query);
    await exchangeCodeForTokens(code);
    res.json({ status: "connected" });
  } catch (err) {
    next(err);
  }
});
