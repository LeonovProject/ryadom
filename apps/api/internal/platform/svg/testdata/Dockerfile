FROM golang:1.27.2-bookworm@sha256:5cf287a799e6b94384bad13d16b14904c531f51ba65792237e122ce42b392f61
RUN go install -tags='no_clickhouse no_libsql no_mssql no_mysql no_sqlite3 no_vertica no_ydb' github.com/pressly/goose/v3/cmd/goose@v3.29.0
WORKDIR /workspace/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
COPY packages/contracts/ /workspace/packages/contracts/
COPY design/assets/ /workspace/design/assets/
CMD ["go", "test", "-race", "-count=1", "-v", "./..."]
