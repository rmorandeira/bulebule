# Stage 1: build backoffice
FROM node:20-alpine AS backoffice-build
WORKDIR /build
COPY backoffice/package*.json ./
RUN npm ci
COPY backoffice/ ./
RUN npm run build

# Stage 2: backend runtime
FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
RUN apk del python3 make g++
COPY server.js gameLogic.js ./
COPY --from=backoffice-build /build/dist ./backoffice-dist
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
