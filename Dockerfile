FROM node:20-alpine

WORKDIR /app

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

# Run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 5000

CMD ["node", "dist/index.js"]
