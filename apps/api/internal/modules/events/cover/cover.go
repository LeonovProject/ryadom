// Package cover stores validated event backgrounds in the existing event transaction.
package cover

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/svg"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct{ clock func() time.Time }

func Register(server *httpapi.Server, clock func() time.Time) error {
	s := &Service{clock: clock}
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"setEventCover", s.set}, {"deleteEventCover", s.remove}, {"getEventCover", s.get}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Фон встречи не найден.")
}

// The same event lock serializes background changes with unpublication. Access
// is checked again under the lock after the runner's actor and owner guard.
func lock(ctx context.Context, r httpapi.Request) (uuid.UUID, error) {
	id := uuid.MustParse(r.PathParams["eventId"])
	v, err := db.New(r.Tx).LockDiscussionEvent(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return id, missing()
	}
	if err != nil {
		return id, err
	}
	if v.ResponsibleAccountID.String() != r.Actor.AccountID {
		return id, missing()
	}
	if v.PublicationStatus != "PUBLISHED" {
		return id, fault.New(409, openapi.ErrorCodeEVENTUNAVAILABLE, "Встреча снята с публикации.")
	}
	return id, nil
}
func (s *Service) set(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.CoverInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	document, err := svg.Normalize(in.Svg)
	if err != nil {
		return httpapi.Response{}, err
	}
	id, err := lock(ctx, r)
	if err != nil {
		return httpapi.Response{}, err
	}
	if err = db.New(r.Tx).SetEventCover(ctx, db.SetEventCoverParams{ID: id, CoverSvg: pgtype.Text{String: document, Valid: true}, UpdatedAt: s.clock().UTC()}); err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Body: openapi.CoverSelection{CoverUrl: "/api/v1/events/" + id.String() + "/cover"}}, nil
}
func (s *Service) remove(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id, err := lock(ctx, r)
	if err != nil {
		return httpapi.Response{}, err
	}
	if err = db.New(r.Tx).SetEventCover(ctx, db.SetEventCoverParams{ID: id, UpdatedAt: s.clock().UTC()}); err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Status: 204}, nil
}
func (s *Service) get(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var viewer pgtype.UUID
	if r.Actor.AccountID != "" {
		viewer = pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}
	}
	// Reuse getEvent's exact visibility predicate and a single SQL snapshot, so a
	// direct image URL cannot reveal a removed meeting to an unrelated reader.
	v, err := db.New(r.Tx).ReadEvent(ctx, db.ReadEventParams{EventID: uuid.MustParse(r.PathParams["eventId"]), ViewerID: viewer, IsAdmin: r.Actor.Role == openapi.MeSystemRoleADMIN})
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if !v.Event.CoverSvg.Valid {
		return httpapi.Response{}, missing()
	}
	return httpapi.SVG(v.Event.CoverSvg.String), nil
}
