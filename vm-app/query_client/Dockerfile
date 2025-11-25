FROM node:18-alpine
WORKDIR /app
COPY package.json /app/
RUN npm install --production
COPY . /app
ENV AUTH_URL=http://172.31.33.47:8080/token
ENV RABBITMQ_URL=amqp://dylan:dylan@172.31.6.99:5672
ENV ZONE=C
CMD ["node","index.js"]

