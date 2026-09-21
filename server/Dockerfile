FROM node:20-alpine

WORKDIR /app/server

COPY server/package*.json ./
RUN npm install --omit=dev

COPY server/server.js ./
COPY web /app/web

ENV NODE_ENV=development
ENV WEB_HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
