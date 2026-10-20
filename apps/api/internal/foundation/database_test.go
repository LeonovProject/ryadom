package foundation

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TestDatabaseCompatibility runs against the isolated Compose preparation DB.
// It verifies pgx and PostgreSQL without creating any product tables.
func TestDatabaseCompatibility(t *testing.T) {
	url := os.Getenv("RYADOM_FOUNDATION_DATABASE_URL")
	if url == "" {
		t.Skip("set RYADOM_FOUNDATION_DATABASE_URL for the isolated PostgreSQL check")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var value int
	if err := pool.QueryRow(ctx, "SELECT 1").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != 1 {
		t.Fatalf("unexpected database result: %d", value)
	}
	var version int
	if err := pool.QueryRow(ctx, "SELECT current_setting('server_version_num')::integer").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version < 170000 || version >= 180000 {
		t.Fatalf("expected PostgreSQL 17, got %d", version)
	}
}
