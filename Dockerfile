# syntax=docker/dockerfile:1

# ---- Stage 1: build the web interface -------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY web ./web
RUN npm run build

# ---- Stage 2: runtime ----------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    SEED_DEMO=1

# ffmpeg converts uploaded hold music from any format to the 8 kHz mono WAV
# Asterisk plays. The runtime user only needs to execute it.
RUN apk add --no-cache ffmpeg

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY server ./server
COPY --from=build /app/web/dist ./web/dist

# Unprivileged runtime, persistent volume for the database. The stock Asterisk
# music-on-hold path is owned by the runtime user so a volume can be mounted
# there and receive the generated audio.
RUN mkdir -p /data /var/lib/asterisk/moh && chown -R node:node /app /data /var/lib/asterisk
USER node
VOLUME ["/data"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
