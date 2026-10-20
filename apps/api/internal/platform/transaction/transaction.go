// Package transaction owns the shared reset barrier for every data operation.
package transaction

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Access string

const (
	Public            Access = "public"
	OptionalSession   Access = "optional-session"
	Session           Access = "session"
	EventOwner        Access = "event-owner"
	OrganizationOwner Access = "organization-owner"
	Admin             Access = "admin"
)

func (a Access) Valid() bool {
	switch a {
	case Public, OptionalSession, Session, EventOwner, OrganizationOwner, Admin:
		return true
	}
	return false
}

type Principal struct {
	AccountID        string
	SessionID        string
	SessionExpiresAt time.Time
	Role             openapi.MeSystemRole
}
type Resource struct{ PathParams map[string]string }

// Guard is implemented by AUTH-01/BE-02. Authenticate MUST lock the actor's
// accounts row FOR SHARE and recheck JWT, ACTIVE and sessions in this transaction.
// Authorize checks ownership after authentication; failures must hide foreign IDs.
type Guard interface {
	Authenticate(context.Context, pgx.Tx, string) (Principal, error)
	Authorize(context.Context, pgx.Tx, Access, Principal, Resource) error
}

type Beginner interface {
	BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
}
type Runner struct {
	DB    Beginner
	Guard Guard
}
type Request struct {
	Access    Access
	Token     *string
	Resource  Resource
	Exclusive bool
}

func (r *Runner) Run(ctx context.Context, req Request, fn func(pgx.Tx, Principal) error) error {
	if !req.Access.Valid() || (req.Exclusive && req.Access != Admin) {
		return fmt.Errorf("invalid transaction policy")
	}
	tx, err := r.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = tx.Rollback(cleanup)
	}()
	lock := "SELECT id FROM demo_state WHERE id = 1 FOR SHARE"
	if req.Exclusive {
		if _, err := tx.Exec(ctx, "SET LOCAL lock_timeout = '5s'"); err != nil {
			return err
		}
		lock = "SELECT id FROM demo_state WHERE id = 1 FOR UPDATE"
	}
	var id int
	if err = tx.QueryRow(ctx, lock).Scan(&id); err != nil {
		var pgErr *pgconn.PgError
		if req.Exclusive && errors.As(err, &pgErr) && pgErr.Code == "55P03" {
			return fault.New(http.StatusConflict, openapi.ErrorCodeDEMORESETBUSY, "Сброс уже занят. Обновите состояние.")
		}
		return err
	}
	if req.Exclusive {
		if _, err := tx.Exec(ctx, "SET LOCAL lock_timeout = '0'"); err != nil {
			return err
		}
	}
	actor := Principal{}
	if req.Access != Public && (req.Access != OptionalSession || req.Token != nil) {
		if req.Token == nil {
			return fault.New(http.StatusUnauthorized, openapi.ErrorCodeAUTHREQUIRED, "Войдите в аккаунт.")
		}
		// Without the real guard protected requests fail closed.
		if r.Guard == nil {
			return fmt.Errorf("session guard is not installed")
		}
		actor, err = r.Guard.Authenticate(ctx, tx, *req.Token)
		if err != nil {
			return err
		}
		if actor.AccountID == "" || (actor.Role != openapi.MeSystemRoleUSER && actor.Role != openapi.MeSystemRoleADMIN) {
			return fmt.Errorf("invalid authenticated principal")
		}
		if req.Access == Admin && actor.Role != openapi.MeSystemRoleADMIN {
			return fault.New(http.StatusForbidden, openapi.ErrorCodeFORBIDDEN, "Недостаточно прав.")
		}
		if req.Access == EventOwner || req.Access == OrganizationOwner {
			if err := r.Guard.Authorize(ctx, tx, req.Access, actor, req.Resource); err != nil {
				return err
			}
		}
	}
	if err := fn(tx, actor); err != nil {
		return err
	}
	// The caller publishes its response only after this commit succeeds. No retries.
	return tx.Commit(ctx)
}
