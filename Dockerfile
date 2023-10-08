FROM oven/bun:canary-alpine

WORKDIR /app

COPY src /app/src
COPY bun.lockb package.json tsconfig.json /app/

RUN apk --no-cache add unzip

# Ensure we're 100% on the newest version
RUN bun upgrade --canary

RUN bun i

CMD bun run start