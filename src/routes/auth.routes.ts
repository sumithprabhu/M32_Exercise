import { Router } from "express";
import { z } from "zod";
import { buildAuthorizationUrl, exchangeCodeForTokens } from "../auth/oauth.service.js";

export const authRouter = Router();

const callbackQuerySchema = z.object({
  code: z.string().min(1, "Missing OAuth 'code' query parameter"),
});

/**
 * @openapi
 * /auth/install:
 *   get:
 *     summary: Start the HubSpot OAuth install flow
 *     description: Redirects the browser to HubSpot's OAuth consent screen. Not meaningfully callable from Swagger's "Try it out" (it's a browser redirect requiring a real HubSpot login), but documented for completeness.
 *     tags: [Auth]
 *     responses:
 *       '302':
 *         description: Redirect to HubSpot's consent screen.
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               example: "https://app.hubspot.com/oauth/authorize?client_id=<your-client-id>&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback&scope=crm.objects.contacts.read+crm.objects.contacts.write"
 */
authRouter.get("/install", (_req, res) => {
  res.redirect(buildAuthorizationUrl());
});

/**
 * @openapi
 * /auth/callback:
 *   get:
 *     summary: Exchange the HubSpot authorization code for tokens
 *     description: HubSpot redirects here after the user clicks Allow on the consent screen. Exchanges the one-time `code` for access/refresh tokens and stores them (singleton oauth_tokens row).
 *     tags: [Auth]
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *           example: na2-99e5-8798-47a4-a52b-9846f30883f8
 *         description: One-time authorization code from HubSpot's redirect. Real example shown is already consumed/expired from prior testing.
 *     responses:
 *       '200':
 *         description: Tokens exchanged and stored successfully.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: connected
 *       '400':
 *         description: Missing or invalid `code` query parameter.
 */
authRouter.get("/callback", async (req, res, next) => {
  try {
    const { code } = callbackQuerySchema.parse(req.query);
    await exchangeCodeForTokens(code);
    res.json({ status: "connected" });
  } catch (err) {
    next(err);
  }
});
