# ResultSpace: one Node process. The web app is built in the first stage; only build/ goes into the image.
FROM node:26.10.0-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:26.10.0-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
COPY --from=web /app/build ./build
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data NODE_ENV=production
# One process owns the data directory. Operator commands: `node src/admin.ts ...` (see docs/deploy).
CMD ["node", "src/server.ts"]
