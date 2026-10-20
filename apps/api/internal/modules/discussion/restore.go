package discussion

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) AdminGet(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	row, err := db.New(r.Tx).ReadAdminMessage(ctx, uuid.MustParse(r.PathParams["messageId"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	v, err := s.adminDTO(ctx, r.Tx, row)
	return httpapi.Response{Body: v}, err
}
func (s *Service) Restore(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.MessageModerationInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["messageId"])
	event, err := q.FindMessageEvent(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if _, err = q.LockDiscussionEvent(ctx, event); err != nil {
		return httpapi.Response{}, err
	}
	m, err := q.LockMessage(ctx, id)
	if err != nil {
		return httpapi.Response{}, err
	}
	if m.Status != "VISIBLE" {
		if int(m.ModerationRevision) != in.ExpectedRevision {
			return httpapi.Response{}, fault.New(409, openapi.ErrorCodeMESSAGECHANGED, "Сообщение изменилось. Обновите сведения.")
		}
		if err = q.RestoreMessage(ctx, db.RestoreMessageParams{ID: id, RestoredAt: pgtype.Timestamptz{Time: s.clock().UTC(), Valid: true}, RestoredBy: pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}}); err != nil {
			return httpapi.Response{}, err
		}
	}
	return s.AdminGet(ctx, r)
}
