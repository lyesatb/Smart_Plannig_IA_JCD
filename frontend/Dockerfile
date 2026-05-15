FROM node:20-alpine

WORKDIR /app

# Désactiver strict SSL (obligatoire dans ton réseau)
RUN npm config set strict-ssl false
RUN npm config set registry http://registry.npmjs.org/

COPY package.json ./
RUN npm install

COPY . .

CMD ["npm", "run", "dev"]
