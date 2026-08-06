FROM node:20-alpine

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Copy prisma files BEFORE npm ci (needed for postinstall)
COPY prisma ./prisma/

# Install dependencies (postinstall will run prisma generate)
RUN npm ci --omit=dev

# Build TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 5000

CMD ["node", "dist/index.js"]
