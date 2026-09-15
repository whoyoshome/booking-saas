# DEVELOPMENT Dockerfile. The production image (static build / standalone
# output) will be defined in Phase 10.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
