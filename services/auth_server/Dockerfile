FROM node:18-alpine
WORKDIR /app
COPY package.json /app/
RUN npm install --production
COPY . /app
ENV PORT=443
CMD ["node","index.js"]
