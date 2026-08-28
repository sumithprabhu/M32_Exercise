import { createApp } from "./app.js";
import { config } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { startContactSyncScheduler } from "./sync/contact-sync.scheduler.js";
import "./db/db.js";

const app = createApp();

app.listen(config.PORT, () => {
  logger.info("server started", { port: config.PORT });
});

startContactSyncScheduler(config.SYNC_INTERVAL_MINUTES);
