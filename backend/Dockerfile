FROM node:20-alpine
WORKDIR /app
# Build tools needed to compile better-sqlite3 from source on musl/Alpine
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
# Remove build tools after compilation to keep image lean
RUN apk del python3 make g++
COPY server.js gameLogic.js ./
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
