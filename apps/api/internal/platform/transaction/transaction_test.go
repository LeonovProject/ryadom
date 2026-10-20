package transaction

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type stubTx struct {
	pgx.Tx
	steps              []string
	lockErr, commitErr error
}
type stubRow struct{ err error }

func (r stubRow) Scan(dest ...any) error {
	if r.err == nil {
		*(dest[0].(*int)) = 1
	}
	return r.err
}
func (tx *stubTx) QueryRow(_ context.Context, query string, _ ...any) pgx.Row {
	tx.steps = append(tx.steps, query)
	return stubRow{tx.lockErr}
}
func (tx *stubTx) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	tx.steps = append(tx.steps, sql)
	return pgconn.CommandTag{}, nil
}
func (tx *stubTx) Commit(context.Context) error {
	tx.steps = append(tx.steps, "commit")
	return tx.commitErr
}
func (tx *stubTx) Rollback(context.Context) error {
	tx.steps = append(tx.steps, "rollback")
	return nil
}

type stubDB struct{ tx *stubTx }

func (db stubDB) BeginTx(_ context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
	if opts.IsoLevel != pgx.ReadCommitted {
		panic("fresh reads required")
	}
	db.tx.steps = append(db.tx.steps, "begin")
	return db.tx, nil
}

type stubGuard struct {
	tx    *stubTx
	role  openapi.MeSystemRole
	err   error
	token string
}

func (g *stubGuard) Authenticate(_ context.Context, _ pgx.Tx, token string) (Principal, error) {
	g.token = token
	g.tx.steps = append(g.tx.steps, "authenticate")
	return Principal{AccountID: "actor", Role: g.role}, g.err
}
func (g *stubGuard) Authorize(_ context.Context, _ pgx.Tx, access Access, _ Principal, resource Resource) error {
	g.tx.steps = append(g.tx.steps, "authorize:"+string(access))
	return nil
}

func TestAccessPoliciesAndOrder(t *testing.T) {
	valid, empty := "jwt", ""
	for _, test := range []struct {
		name        string
		access      Access
		token       *string
		role        openapi.MeSystemRole
		status      int
		auth, owner bool
	}{
		{"public ignores cookie", Public, &valid, openapi.MeSystemRoleUSER, 0, false, false},
		{"optional guest", OptionalSession, nil, openapi.MeSystemRoleUSER, 0, false, false},
		{"optional account", OptionalSession, &valid, openapi.MeSystemRoleUSER, 0, true, false},
		{"session missing", Session, nil, openapi.MeSystemRoleUSER, 401, false, false},
		{"session", Session, &valid, openapi.MeSystemRoleUSER, 0, true, false},
		{"event owner", EventOwner, &valid, openapi.MeSystemRoleUSER, 0, true, true},
		{"organization owner", OrganizationOwner, &valid, openapi.MeSystemRoleUSER, 0, true, true},
		{"admin", Admin, &valid, openapi.MeSystemRoleADMIN, 0, true, false},
		{"user cannot admin", Admin, &valid, openapi.MeSystemRoleUSER, 403, true, false},
		{"empty cookie is presented", OptionalSession, &empty, openapi.MeSystemRoleUSER, 0, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx := &stubTx{}
			guard := &stubGuard{tx: tx, role: test.role}
			runner := Runner{DB: stubDB{tx}, Guard: guard}
			err := runner.Run(context.Background(), Request{Access: test.access, Token: test.token}, func(pgx.Tx, Principal) error { tx.steps = append(tx.steps, "handler"); return nil })
			want := []string{"begin", "SELECT id FROM demo_state WHERE id = 1 FOR SHARE"}
			if test.auth {
				want = append(want, "authenticate")
			}
			if test.owner {
				want = append(want, "authorize:"+string(test.access))
			}
			if test.status == 0 {
				if err != nil {
					t.Fatal(err)
				}
				want = append(want, "handler", "commit")
			} else if fault.Public(err).Status != test.status {
				t.Fatalf("expected %d, got %v", test.status, err)
			}
			want = append(want, "rollback")
			if !reflect.DeepEqual(tx.steps, want) {
				t.Fatalf("order: %v, want %v", tx.steps, want)
			}
		})
	}
}

func TestFailureNeverCommitsOrRetries(t *testing.T) {
	token := "jwt"
	blocked := fault.New(403, openapi.ErrorCodeACCOUNTBLOCKED, "Аккаунт заблокирован.")
	for _, stage := range []string{"barrier", "guard", "handler", "commit"} {
		t.Run(stage, func(t *testing.T) {
			tx := &stubTx{}
			g := &stubGuard{tx: tx, role: openapi.MeSystemRoleUSER}
			if stage == "barrier" {
				tx.lockErr = errors.New("no barrier row")
			}
			if stage == "guard" {
				g.err = blocked
			}
			if stage == "commit" {
				tx.commitErr = errors.New("lost connection")
			}
			calls := 0
			err := (&Runner{DB: stubDB{tx}, Guard: g}).Run(context.Background(), Request{Access: Session, Token: &token}, func(pgx.Tx, Principal) error {
				calls++
				if stage == "handler" {
					return errors.New("write failed")
				}
				return nil
			})
			if err == nil {
				t.Fatal("failure was ignored")
			}
			if calls > 1 {
				t.Fatal("operation retried")
			}
			if stage != "commit" && strings.Contains(strings.Join(tx.steps, ","), "commit") {
				t.Fatal("failed operation committed")
			}
		})
	}
	tx := &stubTx{}
	err := (&Runner{DB: stubDB{tx}}).Run(context.Background(), Request{Access: Session, Token: &token}, func(pgx.Tx, Principal) error { t.Fatal("missing guard allowed access"); return nil })
	if err == nil {
		t.Fatal("missing guard accepted")
	}
}

func TestExclusiveBarrier(t *testing.T) {
	token := "jwt"
	tx := &stubTx{lockErr: &pgconn.PgError{Code: "55P03"}}
	err := (&Runner{DB: stubDB{tx}}).Run(context.Background(), Request{Access: Admin, Token: &token, Exclusive: true}, func(pgx.Tx, Principal) error { t.Fatal("busy reset ran"); return nil })
	if fault.Public(err).Code != openapi.ErrorCodeDEMORESETBUSY {
		t.Fatal(err)
	}
	if len(tx.steps) != 4 || tx.steps[1] != "SET LOCAL lock_timeout = '5s'" || !strings.HasSuffix(tx.steps[2], "FOR UPDATE") {
		t.Fatalf("exclusive order: %v", tx.steps)
	}
	err = (&Runner{DB: stubDB{&stubTx{}}}).Run(context.Background(), Request{Access: Public, Exclusive: true}, func(pgx.Tx, Principal) error { return nil })
	if err == nil {
		t.Fatal("public exclusive transaction accepted")
	}
}
