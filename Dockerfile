# All application artifacts are built from source, without host Go or caches.
FROM sqlc/sqlc:1.31.1@sha256:70f53171d27b2424e9358869975455a6e955a5aa8e58a998a270a6e34e525537 AS sqlgen
WORKDIR /src
COPY apps/api/db/ ./db/
RUN ["/workspace/sqlc", "-f", "db/sqlc.yaml", "generate"]

FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61 AS build
WORKDIR /workspace/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
COPY --from=sqlgen /src/internal/db/ /generated-db/
RUN diff -ru internal/db /generated-db
COPY infra/healthcheck/ /workspace/infra/healthcheck/
COPY infra/tests/probe/ /workspace/infra/tests/probe/
COPY packages/contracts/ /workspace/packages/contracts/
COPY design/assets/ /workspace/design/assets/
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /out/api ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /out/seed ./db/seed/cmd/seed \
 && CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /out/checksvg ./internal/platform/svg/cmd/checksvg \
 && CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /out/healthcheck /workspace/infra/healthcheck/main.go \
 && CGO_ENABLED=0 go build -trimpath -buildvcs=false -o /out/proxy-probe /workspace/infra/tests/probe/main.go
RUN find /workspace/packages/contracts/avatar-presets /workspace/design/assets/event-covers -type f -name '*.svg' -exec /out/checksvg {} +

FROM build AS goose-build
RUN CGO_ENABLED=0 GOBIN=/out go install -tags='no_clickhouse no_libsql no_mssql no_mysql no_sqlite3 no_vertica no_ydb' github.com/pressly/goose/v3/cmd/goose@v3.29.0

FROM scratch AS runtime
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /usr/share/zoneinfo /usr/share/zoneinfo
USER 65532:65532
WORKDIR /

FROM runtime AS migrate
COPY --from=goose-build /out/goose /goose
COPY apps/api/db/migrations/*.sql /migrations/
ENTRYPOINT ["/goose", "-dir", "/migrations"]
CMD ["up"]

FROM runtime AS seed
COPY --from=build /out/seed /seed
COPY packages/contracts/avatar-presets.json /assets/avatar-presets.json
ENTRYPOINT ["/seed", "-presets", "/assets/avatar-presets.json"]

# Explicit test target; this executable never enters the API runtime image.
FROM runtime AS proxy-probe
COPY --from=build /out/healthcheck /healthcheck
COPY --from=build /out/proxy-probe /proxy-probe
ENTRYPOINT ["/proxy-probe"]

FROM runtime AS api
COPY packages/contracts/avatar-presets.json /assets/avatar-presets.json
ENV AVATAR_PRESETS_FILE=/assets/avatar-presets.json
COPY --from=build /out/api /api
COPY --from=build /out/healthcheck /healthcheck
EXPOSE 8080
ENTRYPOINT ["/api"]
