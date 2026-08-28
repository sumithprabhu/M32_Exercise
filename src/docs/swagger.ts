import swaggerJSDoc from "swagger-jsdoc";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = dirname(currentFile);

// swagger-jsdoc parses JSDoc comments from source text, not compiled output --
// but tsc preserves comments by default, so in production this points at the
// compiled dist/routes/*.js (comments intact), and in dev (tsx, no dist/) it
// points at src/routes/*.ts. Same technique db.ts uses to locate schema.sql
// relative to itself rather than assuming a fixed cwd.
const extension = currentFile.endsWith(".ts") ? "ts" : "js";
const routesGlob = join(currentDir, "..", "routes", `*.${extension}`);

export const swaggerSpec = swaggerJSDoc({
  definition: {
    openapi: "3.0.3",
    info: {
      title: "HubSpot Integration Microservice",
      version: "1.0.0",
      description:
        "OAuth2 + webhook + sync integration with HubSpot Contacts. Supplements README.md, see the README for full setup steps and design trade-offs; this is the interactive request/response reference.",
    },
    servers: [{ url: "/" }],
  },
  apis: [routesGlob],
});
