// Package participation owns joins, author decisions and private participation lists.
package participation

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/events"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct {
	accounts *accounts.Service
	events   *events.Service
	key      []byte
	clock    func() time.Time
}

func New(accounts *accounts.Service, events *events.Service, secret []byte, clock func() time.Time) (*Service, error) {
	if accounts == nil || events == nil || len(secret) < 32 || clock == nil {
		return nil, fmt.Errorf("participation requires accounts, events, a secret and a clock")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("ryadom/participation/cursor/v1"))
	return &Service{accounts: accounts, events: events, key: mac.Sum(nil), clock: clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, binding := range []struct {
		id      string
		handler httpapi.Handler
	}{{"joinEvent", s.join}, {"decideParticipation", s.decide}, {"listMyParticipations", s.listMine}, {"listEventParticipations", s.listEvent}} {
		if err := server.Register(binding.id, binding.handler); err != nil {
			return err
		}
	}
	return nil
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Встреча или запись не найдена.")
}
func conflict(code openapi.ErrorCode) error {
	return fault.New(409, code, "Действие сейчас недоступно. Обновите сведения.")
}
func dto(p db.Participation) openapi.Participation {
	value := openapi.Participation{Id: p.ID, EventId: p.EventID, AccountId: p.AccountID, Status: openapi.ParticipationStatus(p.Status), CreatedAt: p.CreatedAt.UTC()}
	if p.DecidedAt.Valid {
		at := p.DecidedAt.Time.UTC()
		value.DecidedAt = &at
	}
	return value
}
func available(e db.Event, now time.Time) error {
	if e.PublicationStatus != "PUBLISHED" {
		return conflict(openapi.ErrorCodeEVENTUNAVAILABLE)
	}
	if !now.Before(e.StartsAt) {
		return conflict(openapi.ErrorCodeEVENTSTARTED)
	}
	return nil
}
func (s *Service) join(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	actor := uuid.MustParse(r.Actor.AccountID)
	q := db.New(r.Tx)
	row, err := q.LockParticipationEvent(ctx, uuid.MustParse(r.PathParams["eventId"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	existing, readErr := q.ReadOwnParticipation(ctx, db.ReadOwnParticipationParams{EventID: row.Event.ID, AccountID: actor})
	if readErr != nil && !errors.Is(readErr, pgx.ErrNoRows) {
		return httpapi.Response{}, readErr
	}
	owner := row.ResponsibleAccountID == actor
	if row.Event.PublicationStatus != "PUBLISHED" && !owner && r.Actor.Role != openapi.MeSystemRoleADMIN && errors.Is(readErr, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	// The event lock serializes joins/decisions/unpublication; actual time is checked
	// after all waits and before even an otherwise idempotent successful repeat.
	if err := available(row.Event, s.clock()); err != nil {
		return httpapi.Response{}, err
	}
	if owner {
		return httpapi.Response{}, conflict(openapi.ErrorCodeALREADYORGANIZER)
	}
	if readErr == nil {
		return httpapi.Response{Body: dto(existing)}, nil
	}
	status := "PENDING"
	if row.Event.JoinMode == "OPEN" {
		status = "CONFIRMED"
	}
	saved, err := q.InsertParticipation(ctx, db.InsertParticipationParams{EventID: row.Event.ID, AccountID: actor, Status: status, CreatedAt: s.clock().UTC()})
	if err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Status: 201, Body: dto(saved)}, nil
}
func (s *Service) decide(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var input openapi.ParticipationDecisionInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
		return httpapi.Response{}, err
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["participationId"])
	eventID, err := q.FindParticipationEvent(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	event, err := q.LockParticipationEvent(ctx, eventID)
	if err != nil {
		return httpapi.Response{}, err
	}
	actor := uuid.MustParse(r.Actor.AccountID)
	if event.ResponsibleAccountID != actor {
		return httpapi.Response{}, missing()
	}
	p, err := q.LockParticipation(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if err := available(event.Event, s.clock()); err != nil {
		return httpapi.Response{}, err
	}
	// OPEN confirmations are never applications, including an ACCEPT repeat.
	if event.Event.JoinMode != "APPROVAL" {
		return httpapi.Response{}, conflict(openapi.ErrorCodeDECISIONCONFLICT)
	}
	status := "REJECTED"
	if input.Decision == "ACCEPT" {
		status = "CONFIRMED"
	}
	if p.Status != "PENDING" {
		if p.Status == status {
			return httpapi.Response{Body: dto(p)}, nil
		}
		return httpapi.Response{}, conflict(openapi.ErrorCodeDECISIONCONFLICT)
	}
	p, err = q.DecideParticipation(ctx, db.DecideParticipationParams{ID: id, Status: status, DecidedBy: pgtype.UUID{Bytes: actor, Valid: true}, DecidedAt: pgtype.Timestamptz{Time: s.clock().UTC(), Valid: true}})
	if err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Body: dto(p)}, nil
}
