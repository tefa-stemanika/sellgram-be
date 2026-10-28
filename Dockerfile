# syntax=docker/dockerfile:1

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN NODE_OPTIONS="--max-old-space-size=384" \
    npm ci --no-audit --no-fund --jobs=2 && \
    npm cache clean --force

COPY . .

ENV PORT=5505
EXPOSE 5505

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||5505)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["sh", "-c", "npx prisma db push --schema=./prisma/schema.prisma && npm start"]
