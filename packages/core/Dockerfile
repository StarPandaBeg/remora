FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/package.json
RUN npm ci --workspace=@remora/core --include-workspace-root

COPY tsconfig.json tsconfig.base.json ./
COPY packages/core/tsconfig.json packages/core/drizzle.config.js ./packages/core/
COPY packages/core/src ./packages/core/src
RUN npm run build --workspace=@remora/core

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/package.json
RUN npm ci --omit=dev --workspace=@remora/core --include-workspace-root

COPY --from=build /app/packages/core/dist ./packages/core/dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "--enable-source-maps", "packages/core/dist/server.js"]
