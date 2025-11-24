FROM node:18-alpine
WORKDIR /app
COPY package.json /app/
RUN npm install --production
COPY . /app
ENV AUTH_URL=https://10.10.0.10/token
ENV RABBITMQ_URL=amqp://10.10.0.20:5672
ENV WS_PORT=8080
EXPOSE 8080
CMD ["node","index.js"]

