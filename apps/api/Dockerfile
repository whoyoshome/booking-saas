# Development image. The production image is Dockerfile.prod.
FROM node:26-alpine

# Prisma's query engine requires openssl at runtime; without it, Alpine fails
# with a confusing connection error (the missing system lib is not obvious
# from the error message).
RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

COPY . .

EXPOSE 3001

CMD ["npm", "run", "start:dev"]
