FROM node:20-alpine

LABEL org.opencontainers.image.title="Void Operations Server"
LABEL org.opencontainers.image.description="Terminal drone MMO — game server"

# Install build tools needed for better-sqlite3 native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy only the server package manifest first (layer cache optimization)
COPY server/package*.json ./

RUN npm install --omit=dev

# Copy the rest of the server source
COPY server/ .

# Persistent data directory (mounted as a volume in docker-compose)
RUN mkdir -p /app/db

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "index.js"]
