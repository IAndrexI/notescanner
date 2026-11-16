FROM node:22-alpine

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY server.js seafile-client.js ./
COPY public/ ./public/

# Environment variables
ENV PORT=3000
ENV NODE_ENV=production
ENV DATA_DIR=/app/data

# Persist data/config
VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
