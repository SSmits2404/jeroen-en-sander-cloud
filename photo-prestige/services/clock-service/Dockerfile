FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
HEALTHCHECK --interval=60s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Clock service running')" || exit 1
CMD ["npm", "start"]
