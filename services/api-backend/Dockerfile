FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY src/ src/
# Generate RSA keys if not provided via volume mount
RUN mkdir -p keys && \
    if [ ! -f keys/private.pem ]; then \
      openssl genrsa -out keys/private.pem 2048 && \
      openssl rsa -in keys/private.pem -pubout -out keys/public.pem; \
    fi
EXPOSE 3000
CMD ["node", "src/app.js"]
