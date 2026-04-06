FROM node:20-alpine AS base

# Install FFmpeg with v360 filter support
RUN apk add --no-cache ffmpeg
# Verify v360 filter is available
RUN ffmpeg -filters 2>/dev/null | grep v360

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --production

FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV TEMP_DIR=/tmp/360aligner

RUN mkdir -p /tmp/360aligner
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]
