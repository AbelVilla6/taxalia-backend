# Backend content + chat service.
# better-sqlite3 is a native module; node-gyp build tools are included so it
# compiles on any platform that lacks a prebuilt binary.
FROM node:24-bookworm-slim AS base
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# SQLite content database lives on a mounted volume (persistent host disk).
ENV BLOG_DB_PATH=/app/data/blog.db
ENV PORT=4324
EXPOSE 4324

CMD ["npm", "start"]
