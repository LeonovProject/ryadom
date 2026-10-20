package auth

import (
	"context"
	"errors"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/transaction"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func expired() error {
	e := fault.New(401, openapi.ErrorCodeSESSIONEXPIRED, "Сессия завершена. Войдите снова.")
	e.ClearSession = true
	return e
}
func blocked(clear bool) error {
	e := fault.New(403, openapi.ErrorCodeACCOUNTBLOCKED, "Аккаунт заблокирован.")
	e.ClearSession = clear
	return e
}

// Authenticate is called only after Runner's shared reset barrier. The actor
// lock remains held through the handler/commit, preventing a concurrent block
// from overtaking an authorized operation. JWT is checked again after waiting.
func (s *Service) Authenticate(ctx context.Context, tx pgx.Tx, raw string) (transaction.Principal, error) {
	claims, err := s.tokens.Verify(raw)
	if err != nil {
		return transaction.Principal{}, expired()
	}
	q := db.New(tx)
	actor, err := q.LockSessionActor(ctx, claims.AccountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return transaction.Principal{}, expired()
	}
	if err != nil {
		return transaction.Principal{}, err
	}
	claims, err = s.tokens.Verify(raw)
	if err != nil {
		return transaction.Principal{}, expired()
	}
	if actor.Status == "BLOCKED" {
		return transaction.Principal{}, blocked(true)
	}
	if actor.Status != "ACTIVE" {
		return transaction.Principal{}, expired()
	}
	matches, err := q.SessionMatches(ctx, db.SessionMatchesParams{SessionID: claims.SessionID, AccountID: claims.AccountID, TokenHash: authn.TokenDigest(raw), IssuedAt: claims.IssuedAt, ExpiresAt: claims.ExpiresAt, CheckedAt: s.clock()})
	if err != nil {
		return transaction.Principal{}, err
	}
	if !matches || !s.clock().Before(claims.ExpiresAt) {
		return transaction.Principal{}, expired()
	}
	return transaction.Principal{AccountID: actor.ID.String(), Role: openapi.MeSystemRole(actor.SystemRole), SessionID: claims.SessionID.String(), SessionExpiresAt: claims.ExpiresAt}, nil
}
func (s *Service) Authorize(ctx context.Context, tx pgx.Tx, access transaction.Access, actor transaction.Principal, r transaction.Resource) error {
	account, err := uuid.Parse(actor.AccountID)
	if err != nil {
		return err
	}
	var owned bool
	switch access {
	case transaction.EventOwner:
		id, e := uuid.Parse(r.PathParams["eventId"])
		if e != nil {
			return e
		}
		owned, err = db.New(tx).EventOwnedBy(ctx, db.EventOwnedByParams{ID: id, CreatedByAccountID: account})
	case transaction.OrganizationOwner:
		id, e := uuid.Parse(r.PathParams["organizationId"])
		if e != nil {
			return e
		}
		owned, err = db.New(tx).OrganizationOwnedBy(ctx, db.OrganizationOwnedByParams{ID: id, OwnerAccountID: account})
	default:
		return errors.New("unsupported owner policy")
	}
	if err != nil {
		return err
	}
	if !owned {
		return fault.New(404, openapi.ErrorCodeNOTFOUND, "Ресурс не найден.")
	}
	return nil
}

// revokePresented is shared by successful account switching and public logout.
// Invalid/expired/absent credentials cannot delete another session. BLOCKED does
// not prevent clearing the presented session; all failures remain transactional.
func (s *Service) revokePresented(ctx context.Context, tx pgx.Tx, raw string) error {
	claims, err := s.tokens.Verify(raw)
	if err != nil {
		return nil
	}
	q := db.New(tx)
	_, err = q.LockSessionActor(ctx, claims.AccountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	claims, err = s.tokens.Verify(raw)
	if err != nil {
		return nil
	}
	return q.DeletePresentedSession(ctx, db.DeletePresentedSessionParams{ID: claims.SessionID, AccountID: claims.AccountID, TokenHash: authn.TokenDigest(raw)})
}
