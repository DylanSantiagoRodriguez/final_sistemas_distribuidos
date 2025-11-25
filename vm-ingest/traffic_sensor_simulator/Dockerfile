FROM node:18-alpine

WORKDIR /app

# Configurar DNS explícitamente
RUN echo "nameserver 8.8.8.8" > /etc/resolv.conf

COPY package.json /app/
RUN npm install --production

COPY . /app

ENV AUTH_URL=https://172.31.35.24/token
ENV KAFKA_BROKER=172.31.6.99:9092
ENV ALLOW_INSECURE_TLS=true

CMD ["node","index.js"]