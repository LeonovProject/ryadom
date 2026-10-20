package participation

import (
	"context"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) listEvent(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id := uuid.MustParse(r.PathParams["eventId"])
	c, limit, statuses, err := s.page(r.HTTP.URL.Query(), "listEventParticipations", r.Actor.AccountID, id.String())
	if err != nil {
		return httpapi.Response{}, err
	}
	at, key := c.key()
	rows, err := db.New(r.Tx).ListEventParticipations(ctx, db.ListEventParticipationsParams{EventID: id, Statuses: statuses, CursorTime: at, CursorID: key, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.ParticipantPage{Items: make([]openapi.ParticipantEntry, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		c.Time = rows[limit-1].CreatedAt
		c.ID = rows[limit-1].ID
		next := s.encode(c)
		body.NextCursor = &next
		rows = rows[:limit]
	}
	for _, p := range rows {
		account, err := s.accounts.Public(ctx, r.Tx, p.AccountID)
		if err != nil {
			return httpapi.Response{}, err
		}
		value := dto(p)
		body.Items = append(body.Items, openapi.ParticipantEntry{Id: value.Id, EventId: value.EventId, AccountId: value.AccountId, Status: value.Status, CreatedAt: value.CreatedAt, DecidedAt: value.DecidedAt, Account: account})
	}
	return httpapi.Response{Body: body}, nil
}
func (s *Service) listMine(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	c, limit, statuses, err := s.page(r.HTTP.URL.Query(), "listMyParticipations", r.Actor.AccountID, "")
	if err != nil {
		return httpapi.Response{}, err
	}
	at, key := c.key()
	var reference pgtype.Timestamptz
	if c.Reference != nil {
		reference = pgtype.Timestamptz{Time: c.Reference.Truncate(time.Microsecond), Valid: true}
	}
	rows, err := db.New(r.Tx).ListMyParticipations(ctx, db.ListMyParticipationsParams{AccountID: uuid.MustParse(r.Actor.AccountID), Statuses: statuses, EventWindow: c.Window, ReferenceTime: reference, CursorTime: at, CursorID: key, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.MyParticipationPage{Items: make([]openapi.MyParticipationEntry, 0, min(limit, len(rows))), ReferenceTime: c.Reference}
	if len(rows) > limit {
		last := rows[limit-1]
		c.Time = last.Participation.CreatedAt
		c.ID = last.Participation.ID
		if c.Window != "" {
			c.Time = last.Event.StartsAt
			c.ID = last.Event.ID
		}
		next := s.encode(c)
		body.NextCursor = &next
		rows = rows[:limit]
	}
	for _, row := range rows {
		var summary openapi.EventSummary
		if row.Event.PublicationStatus == "PUBLISHED" {
			published, err := s.events.Summary(ctx, r.Tx, db.ReadEventRow{Event: row.Event, ActivityType: row.ActivityType, OrganizationName: row.OrganizationName, ResponsibleAccountID: row.ResponsibleAccountID, OwnerIsBlocked: row.OwnerIsBlocked})
			if err != nil {
				return httpapi.Response{}, err
			}
			if err = summary.FromPublishedEventSummary(published); err != nil {
				return httpapi.Response{}, err
			}
		} else {
			if err = summary.FromUnavailableEventSummary(openapi.UnavailableEventSummary{Id: row.Event.ID, Title: row.Event.Title, PublicationStatus: "UNPUBLISHED"}); err != nil {
				return httpapi.Response{}, err
			}
		}
		body.Items = append(body.Items, openapi.MyParticipationEntry{Event: summary, Participation: dto(row.Participation)})
	}
	return httpapi.Response{Body: body}, nil
}
