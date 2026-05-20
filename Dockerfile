FROM node:20-bookworm-slim

# Install ffmpeg system-wide (though ffmpeg-static usually handles it, it's safer to have it)
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Build the application (compiles frontend and backend)
RUN npm run build

# Expose the port your app runs on (Hugging Face Spaces requires port 7860)
EXPOSE 7860

# Set port to 7860 for Hugging Face Spaces
ENV PORT=7860
ENV NODE_ENV=production

# Start the application
CMD ["npm", "start"]
