import express, { type Request } from "express";
import swaggerUi from "swagger-ui-express";
import { requestLogger } from "./middleware/request-logger.js";
import { errorHandler } from "./middleware/error-handler.js";
import { authRouter } from "./routes/auth.routes.js";
import { syncRouter } from "./routes/sync.routes.js";
import { contactsRouter } from "./routes/contacts.routes.js";
import { webhookRouter } from "./routes/webhook.routes.js";
import { swaggerSpec } from "./docs/swagger.js";

export function createApp() {
  const app = express();

  // Required so req.protocol reflects X-Forwarded-Proto from a reverse proxy/tunnel
  // (ngrok, etc.) — HubSpot signs webhook requests with the public HTTPS URL it
  // called, and without this Express reports the plain-HTTP protocol of the
  // proxy-to-app hop instead, breaking signature verification.
  app.set("trust proxy", true);

  // Captures the exact raw bytes of the body so webhook signature verification
  // can HMAC what HubSpot actually sent, not a re-serialized (and potentially
  // byte-different) copy of the parsed JSON.
  app.use(
    express.json({
      verify: (req: Request, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    })
  );
  app.use(requestLogger);

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use("/auth", authRouter);
  app.use("/sync", syncRouter);
  app.use("/contacts", contactsRouter);
  app.use("/webhook", webhookRouter);

  app.use(errorHandler);

  return app;
}
