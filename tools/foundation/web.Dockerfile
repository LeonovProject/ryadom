FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3
RUN npm install --global pnpm@11.25.0
WORKDIR /workspace
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/api-client/package.json packages/api-client/package.json
RUN pnpm install --frozen-lockfile
COPY apps/web/ apps/web/
COPY packages/api-client/ packages/api-client/
COPY brandbook/assets/ brandbook/assets/
RUN pnpm typecheck && pnpm build
CMD ["node", "-e", "console.log('BASE-01 web build completed; no product server started')"]
