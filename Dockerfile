FROM node:22-alpine

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3080
ENV HOST=0.0.0.0

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3080/api/health || exit 1

CMD ["node", "server.js"]
