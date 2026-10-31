# syntax=docker/dockerfile:1

# --- Build stage -------------------------------------------------------
# node:22-slim bookworm, linux/amd64+arm64, pinned 2026-10-05.
# To update: docker buildx imagetools inspect node:22-slim → the index digest.
FROM node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The only values baked into the image: $env/static/public inlines these two
# into the client bundle at build time. Both are public (Supabase URL and anon
# key). Everything else (SUPABASE_SERVICE_KEY, SETUP_TOKEN, TBA_API_KEY, ...) is set
# at run time, e.g. docker run --env-file .env.
ARG PUBLIC_SUPABASE_URL
ARG PUBLIC_SUPABASE_ANON_KEY
RUN PUBLIC_SUPABASE_URL=$PUBLIC_SUPABASE_URL PUBLIC_SUPABASE_ANON_KEY=$PUBLIC_SUPABASE_ANON_KEY \
	npm run build && npm prune --omit=dev

# --- Runtime stage -----------------------------------------------------
FROM node:22-slim@sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node --from=build /app/build ./build
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json ./package.json

USER node

# adapter-node reads PORT (and ORIGIN, the public address) from the environment.
EXPOSE 8080
CMD ["node", "build/index.js"]
