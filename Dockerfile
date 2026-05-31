FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache curl

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

COPY . .

RUN npx prisma generate

EXPOSE 3000

CMD ["npm", "run", "start:deploy"]
