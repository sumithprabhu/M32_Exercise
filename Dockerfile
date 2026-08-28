# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 is a native addon; these let it compile from source if a
# prebuilt binary isn't available for the target platform/arch.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Strip devDependencies from the same node_modules that was just used to build,
# so the already-compiled native binary carries forward instead of getting
# reinstalled (and potentially rebuilt) in a separate stage.
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.js"]
