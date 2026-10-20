FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS svg-check
WORKDIR /workspace/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
COPY packages/contracts/ /workspace/packages/contracts/
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /checksvg ./internal/platform/svg/cmd/checksvg \
 && mkdir -p /out/avatars \
 && find /workspace/packages/contracts/avatar-presets -type f -name '*.svg' -exec /checksvg {} + \
 && find /workspace/packages/contracts/avatar-presets -type f -name '*.svg' -exec cp {} /out/avatars/ \;

FROM node:22.23.1-bookworm-slim@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3 AS web-build
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
RUN mkdir -p /out/docs \
 && cp node_modules/swagger-ui-dist/swagger-ui-bundle.js node_modules/swagger-ui-dist/swagger-ui.css /out/docs/
COPY infra/web/docs/ /out/docs/

FROM nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/*
COPY --from=web-build /workspace/apps/web/dist/ /usr/share/nginx/html/
COPY --from=web-build /out/docs/ /usr/share/nginx/html/api/docs/
COPY --from=svg-check /out/avatars/ /usr/share/nginx/html/assets/avatars/presets/
COPY packages/contracts/openapi.yaml /usr/share/nginx/html/api/openapi.yaml
COPY infra/web/*.conf /etc/nginx/
USER 101:101
EXPOSE 8080 8443
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
