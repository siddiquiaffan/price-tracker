FROM node:14

# Create app directory
WORKDIR /app

# Bundle app source
COPY . .

# Install app dependencies
COPY package*.json ./
RUN npm install

#Start App
CMD ["npm", "start"]