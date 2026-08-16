# One process serves the API and the built frontend, so one stage is enough:
# the client build needs the same dependencies the server runs on.
FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Vite inlines VITE_* at build time, so the Clerk publishable key has to be a
# build ARG. It is public by design; the secret key stays a runtime env var.
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

RUN bun run build

# Try-on renders are written here at runtime and served from /generated.
RUN mkdir -p renders

ENV PORT=8787
EXPOSE 8787

CMD ["bun", "server.ts"]
