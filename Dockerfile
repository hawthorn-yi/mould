FROM node:22-alpine

WORKDIR /app

COPY package.json server.js ./
COPY public ./public
COPY data ./data

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "server.js"]
