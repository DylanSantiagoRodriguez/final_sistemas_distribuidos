FROM node:18-alpine
WORKDIR /app
COPY package.json /app/
RUN npm install --production
COPY . /app
ENV AUTH_URL=https://10.10.0.10/token
ENV KAFKA_BROKER=10.10.0.20:9092
ENV RABBITMQ_URL=amqp://10.10.0.20:5672
CMD ["node","index.js"]

