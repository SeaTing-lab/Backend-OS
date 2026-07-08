FROM node:20-bookworm-slim

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts

COPY . .

RUN DATABASE_URL="postgresql://user:password@localhost:5432/app" \
    npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "start:deploy"]
