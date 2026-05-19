FROM node:20-alpine
WORKDIR /app
COPY package.json clients.json ./
RUN npm install --production
COPY index.js .
EXPOSE 443
CMD ["node", "index.js"]
