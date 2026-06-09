FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server.js gameLogic.js ./
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
