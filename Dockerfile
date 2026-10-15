# The marlo command line, with nothing to install but Docker.
#
#   docker run --rm -v "$PWD:/work" ghcr.io/karthiksubramanian07/marlo scan page.html
#
# The static renderer only: no browser in the image, which keeps it small and keeps the
# image's behaviour identical to `pnpm check` on a laptop. Rules that need layout are
# reported as not examined, exactly as they are without Docker.

FROM node:22.13.0-bookworm-slim AS build
WORKDIR /src
# corepack in Node 22.13 ships signing keys npm has since rotated, so pnpm comes from npm.
RUN npm install -g pnpm@9.15.9
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm build \
  && pnpm --filter @marlo/cli deploy --prod /app/packages/cli

FROM node:22.13.0-bookworm-slim
ENV NODE_ENV=production
# The CLI reads its confidence figures from calibration/ at the repository root, two
# directories above its package, so the image keeps that shape.
COPY --from=build /app /app
COPY calibration/table.json calibration/browser.json /app/calibration/
COPY LICENSE /app/
WORKDIR /work
USER node
ENTRYPOINT ["node", "/app/packages/cli/dist/bin.js"]
CMD ["--help"]
