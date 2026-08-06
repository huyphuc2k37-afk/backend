FROM node:20-slim

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first
COPY package*.json ./

# Copy prisma files BEFORE npm ci (needed for postinstall)
COPY prisma ./prisma/

# Install ALL dependencies (including dev for build)
RUN npm ci

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Remove devDependencies to slim down image
RUN npm prune --production

EXPOSE 5000

CMD ["node", "dist/index.js"]
