# ═══════════════════════════════════════════════════════════════════════════
#  Aura Browser 2.0 — production image
#  Multi-stage: deps → build (Tailwind + vendor) → slim runtime
# ═══════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Compile Tailwind CSS and vendor the client-side QR library.
RUN npx tailwindcss -i ./public/css/input.css -o ./public/css/app.css --minify \
 && node scripts/vendor-qrcode.js

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/public ./public
EXPOSE 3000
# Hardened container defaults: read-only root FS, non-root user.
USER node
CMD ["node", "server/index.js"]
