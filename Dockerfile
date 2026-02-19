FROM node:20-alpine

LABEL org.opencontainers.image.title="Void Operations Server"
LABEL org.opencontainers.image.description="Terminal drone MMO — game server"

# Install build tools needed for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

ARG VOID_SERVER_URL=
ENV VOID_SERVER_URL=${VOID_SERVER_URL}

# Copy package manifests for cache-friendly installs
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN npm install --omit=dev --prefix server

# Copy source
COPY server ./server
COPY client ./client
COPY scripts/build-client-tarball.js ./scripts/

# Build the client tarball for download
RUN node scripts/build-client-tarball.js

# Persistent data directory (mounted as a volume in docker-compose)
RUN mkdir -p /app/server/db

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server/index.js"]
