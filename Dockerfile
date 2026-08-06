FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy prisma
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source and build
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# Run as non-root
RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 5000

CMD ["node", "dist/index.js"]
