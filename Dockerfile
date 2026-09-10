# Home Assistant local add-on image for the Eduarte bridge.
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
# the bundled Chromium download is skipped; the runtime image uses Alpine's build.
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc


FROM node:22-alpine

RUN apk add --no-cache \
        chromium \
        nss \
        freetype \
        harfbuzz \
        ca-certificates \
        font-noto \
        tzdata \
    # the binary is called chromium on newer Alpine releases.
    && { [ -e /usr/bin/chromium-browser ] || ln -s /usr/bin/chromium /usr/bin/chromium-browser; }

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    DATA_DIR=/data \
    DISABLE_SANDBOX=true \
    TZ=Europe/Amsterdam

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

EXPOSE 8099
CMD ["node", "dist/index.js"]
