FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev
RUN apk del python3 make g++
COPY server.js gameLogic.js ./
COPY backoffice-dist ./backoffice-dist
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
