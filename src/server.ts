import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import "./db/db.js";

const app = createApp();

app.listen(config.PORT, () => {
  logger.info("server started", { port: config.PORT });
});
