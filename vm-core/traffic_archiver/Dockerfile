FROM node:18-alpine
WORKDIR /app
COPY package.json /app/
RUN npm install --production
COPY . /app
ENV AUTH_URL=http://host.docker.internal:8444/token
ENV KAFKA_BROKER=host.docker.internal:9092
CMD ["node","index.js"]

