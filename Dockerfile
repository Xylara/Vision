FROM node:22-slim

ENV NODE_ENV=production

WORKDIR /app

# Install dependencies first so Docker can cache this layer.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

USER node

CMD ["node", "src/index.js"]
