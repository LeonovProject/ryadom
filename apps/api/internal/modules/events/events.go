// Package events implements read operations against the shared transaction/guard.
package events

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct {
	accounts  *accounts.Service
	cursorKey []byte
	clock     func() time.Time
}

// New derives a cursor-only key. It never accepts JWTs as pagination cursors.
func New(accounts *accounts.Service, secret []byte, clock func() time.Time) (*Service, error) {
	if accounts == nil || len(secret) < 32 || clock == nil {
		return nil, fmt.Errorf("events require accounts, a cursor secret and a clock")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("ryadom/events/cursor/v1"))
	return &Service{accounts: accounts, cursorKey: mac.Sum(nil), clock: clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, binding := range []struct {
		id      string
		handler httpapi.Handler
	}{
		{"listEvents", s.list}, {"getEvent", s.get}, {"listMyEvents", s.listMine},
	} {
		if err := server.Register(binding.id, binding.handler); err != nil {
			return err
		}
	}
	return nil
}

func pageCursor(s *Service, r httpapi.Request, scope string) (pgtype.Timestamptz, pgtype.UUID, error) {
	values, ok := r.HTTP.URL.Query()["cursor"]
	if !ok {
		return pgtype.Timestamptz{}, pgtype.UUID{}, nil
	}
	if len(values) != 1 {
		return pgtype.Timestamptz{}, pgtype.UUID{}, invalidCursor()
	}
	c, err := s.decodeCursor(values[0], scope)
	return pgtype.Timestamptz{Time: c.Time, Valid: err == nil}, pgtype.UUID{Bytes: c.ID, Valid: err == nil}, err
}
func (s *Service) list(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	f, limit, err := parseFilters(r.HTTP.URL.Query())
	if err != nil {
		return httpapi.Response{}, err
	}
	scope := scope("listEvents", "", f)
	at, id, err := pageCursor(s, r, scope)
	if err != nil {
		return httpapi.Response{}, err
	}
	rows, err := db.New(r.Tx).ListCatalogEvents(ctx, db.ListCatalogEventsParams{
		SearchQuery: f.Query, City: f.City, JoinMode: f.JoinMode,
		ActivityTypeID: nullableUUID(f.ActivityTypeID), OrganizationID: nullableUUID(f.OrganizationID), OrganizerAccountID: nullableUUID(f.OrganizerAccountID),
		FromTime: nullableTime(f.From), ToTime: nullableTime(f.To), DateFrom: nullableDate(f.DateFrom), DateTo: nullableDate(f.DateTo),
		CursorTime: at, CursorID: id, PageSize: int32(limit + 1),
	})
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.EventPage{Items: make([]openapi.PublishedEventSummary, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		value := s.encodeCursor(scope, rows[limit-1].Event.StartsAt, rows[limit-1].Event.ID)
		body.NextCursor = &value
		rows = rows[:limit]
	}
	for _, row := range rows {
		summary, err := s.summary(ctx, r.Tx, db.ReadEventRow(row))
		if err != nil {
			return httpapi.Response{}, err
		}
		body.Items = append(body.Items, summary)
	}
	return httpapi.Response{Body: body}, nil
}
func (s *Service) listMine(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	f, limit, err := parseFilters(r.HTTP.URL.Query())
	if err != nil {
		return httpapi.Response{}, err
	}
	owner, err := uuid.Parse(r.Actor.AccountID)
	if err != nil {
		return httpapi.Response{}, err
	}
	q := db.New(r.Tx)
	if f.OrganizationID != "" {
		_, err := q.ReadOwnedEventsOrganization(ctx, db.ReadOwnedEventsOrganizationParams{ID: uuid.MustParse(f.OrganizationID), OwnerAccountID: owner})
		if errors.Is(err, pgx.ErrNoRows) {
			return httpapi.Response{}, fault.New(404, openapi.ErrorCodeNOTFOUND, "Организация не найдена.")
		}
		if err != nil {
			return httpapi.Response{}, err
		}
	}
	scope := scope("listMyEvents", owner.String(), f)
	at, id, err := pageCursor(s, r, scope)
	if err != nil {
		return httpapi.Response{}, err
	}
	rows, err := q.ListOwnedEvents(ctx, db.ListOwnedEventsParams{OwnerID: owner, ViewerID: nullableUUID(owner.String()), OrganizationID: nullableUUID(f.OrganizationID), CursorTime: at, CursorID: id, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.OwnedEventPage{Items: make([]openapi.OwnedEventEntry, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		value := s.encodeCursor(scope, rows[limit-1].Event.CreatedAt, rows[limit-1].Event.ID)
		body.NextCursor = &value
		rows = rows[:limit]
	}
	for _, row := range rows {
		var event openapi.EventSummary
		if row.Event.PublicationStatus == "PUBLISHED" {
			summary, err := s.summary(ctx, r.Tx, db.ReadEventRow(row))
			if err != nil {
				return httpapi.Response{}, err
			}
			if err := event.FromPublishedEventSummary(summary); err != nil {
				return httpapi.Response{}, err
			}
		} else {
			if err := event.FromUnavailableEventSummary(openapi.UnavailableEventSummary{Id: row.Event.ID, Title: row.Event.Title, PublicationStatus: "UNPUBLISHED"}); err != nil {
				return httpapi.Response{}, err
			}
		}
		body.Items = append(body.Items, openapi.OwnedEventEntry{Event: event, CanManageParticipants: true})
	}
	return httpapi.Response{Body: body}, nil
}
func (s *Service) get(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id, err := uuid.Parse(r.PathParams["eventId"])
	if err != nil {
		return httpapi.Response{}, invalidRequest()
	}
	row, err := db.New(r.Tx).ReadEvent(ctx, db.ReadEventParams{EventID: id, ViewerID: nullableUUID(r.Actor.AccountID), IsAdmin: r.Actor.Role == openapi.MeSystemRoleADMIN})
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, fault.New(404, openapi.ErrorCodeNOTFOUND, "Встреча не найдена.")
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	owner := r.Actor.AccountID == row.ResponsibleAccountID.String()
	var participation *openapi.NullableParticipation
	if row.ParticipationID.Valid {
		participation = &openapi.NullableParticipation{Id: uuid.UUID(row.ParticipationID.Bytes), EventId: id, AccountId: uuid.UUID(row.ParticipationAccountID.Bytes), Status: openapi.ParticipationStatus(row.ParticipationStatus.String), CreatedAt: row.ParticipationCreatedAt.Time.UTC()}
		if row.ParticipationDecidedAt.Valid {
			at := row.ParticipationDecidedAt.Time.UTC()
			participation.DecidedAt = &at
		}
	}
	if row.Event.PublicationStatus == "UNPUBLISHED" {
		var reason *string
		if owner || r.Actor.Role == openapi.MeSystemRoleADMIN {
			reason = &row.Event.UnpublishReason.String
		}
		return httpapi.Response{Body: openapi.UnavailableEventDetail{Id: id, Title: row.Event.Title, PublicationStatus: "UNPUBLISHED", MyParticipation: participation, UnpublishReason: reason}}, nil
	}
	summary, err := s.summary(ctx, r.Tx, row)
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.PublishedEventDetail{
		Id: id, Title: summary.Title, ActivityType: summary.ActivityType, Organizer: summary.Organizer,
		StartsAt: summary.StartsAt, Timezone: summary.Timezone, City: summary.City, LocationText: summary.LocationText,
		JoinMode: summary.JoinMode, PublicationStatus: "PUBLISHED", CoverUrl: summary.CoverUrl,
		Description: row.Event.Description, Conditions: row.Event.Conditions, ConfirmedCount: int(row.ConfirmedCount), MyParticipation: participation,
		Capabilities: capabilities(s.clock(), row.Event.StartsAt, r.Actor.AccountID != "", owner, participation != nil),
	}
	if owner {
		body.ActivityTypeReview = &openapi.NullableActivityTypeReview{CatalogStatus: openapi.ActivityTypeCatalogStatus(row.ActivityType.CatalogStatus)}
		if row.ActivityType.RejectionReason.Valid {
			body.ActivityTypeReview.RejectionReason = &row.ActivityType.RejectionReason.String
		}
	}
	return httpapi.Response{Body: body}, nil
}
func capabilities(now, startsAt time.Time, authenticated, owner, participating bool) openapi.EventCapabilities {
	c := openapi.EventCapabilities{CanManageParticipants: owner, CanDecideParticipations: owner && now.Before(startsAt), CanPostMessage: authenticated, CanSetCover: owner}
	var reason openapi.EventCapabilitiesJoinBlockedReason
	switch {
	case !now.Before(startsAt):
		reason = "EVENT_STARTED"
	case !authenticated:
		reason = "AUTH_REQUIRED"
	case owner:
		reason = "ALREADY_ORGANIZER"
	case participating:
		reason = "ALREADY_PARTICIPATING"
	default:
		c.CanJoin = true
		return c
	}
	c.JoinBlockedReason = &reason
	return c
}
func (s *Service) summary(ctx context.Context, tx pgx.Tx, row db.ReadEventRow) (openapi.PublishedEventSummary, error) {
	e := row.Event
	var organizer openapi.Organizer
	if e.OrganizationID.Valid {
		if err := organizer.FromOrganizationOrganizer(openapi.OrganizationOrganizer{Type: "ORGANIZATION", Organization: openapi.OrganizationRef{Id: uuid.UUID(e.OrganizationID.Bytes), Name: row.OrganizationName}, OwnerIsBlocked: row.OwnerIsBlocked}); err != nil {
			return openapi.PublishedEventSummary{}, err
		}
	} else {
		account, err := s.accounts.Public(ctx, tx, row.ResponsibleAccountID)
		if err != nil {
			return openapi.PublishedEventSummary{}, err
		}
		if err := organizer.FromPersonalOrganizer(openapi.PersonalOrganizer{Type: "PERSONAL", Account: account}); err != nil {
			return openapi.PublishedEventSummary{}, err
		}
	}
	var cover *string
	if e.CoverSvg.Valid {
		value := fmt.Sprintf("/api/v1/events/%s/cover", e.ID)
		cover = &value
	}
	return openapi.PublishedEventSummary{Id: e.ID, Title: e.Title, ActivityType: openapi.ActivityType{Id: row.ActivityType.ID, Name: row.ActivityType.Name}, Organizer: organizer, StartsAt: e.StartsAt.UTC(), Timezone: e.Timezone, City: e.City, LocationText: e.LocationText, JoinMode: openapi.JoinMode(e.JoinMode), PublicationStatus: "PUBLISHED", CoverUrl: cover}, nil
}
