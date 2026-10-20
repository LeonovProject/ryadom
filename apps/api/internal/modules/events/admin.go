package events

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func adminMissing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Встреча не найдена.")
}

// adminDTO reuses the organizer/activity/cover projection, with the real publication
// state and private moderation fields added only for the ADMIN routes.
func (s *Service) adminDTO(ctx context.Context, tx pgx.Tx, row db.ReadAdminEventRow, actor string) (openapi.AdminEvent, error) {
	e := row.Event
	summary, err := s.Summary(ctx, tx, db.ReadEventRow{Event: e, ActivityType: row.ActivityType, OrganizationName: row.OrganizationName, ResponsibleAccountID: row.ResponsibleAccountID, OwnerIsBlocked: row.OwnerIsBlocked})
	if err != nil {
		return openapi.AdminEvent{}, err
	}
	creator, err := s.accounts.Public(ctx, tx, e.CreatedByAccountID)
	if err != nil {
		return openapi.AdminEvent{}, err
	}
	value := openapi.AdminEvent{Id: e.ID, Title: e.Title, ActivityType: summary.ActivityType, Organizer: summary.Organizer, StartsAt: e.StartsAt.UTC(), Timezone: e.Timezone, City: e.City, LocationText: e.LocationText, JoinMode: openapi.JoinMode(e.JoinMode), PublicationStatus: openapi.PublicationStatus(e.PublicationStatus), CoverUrl: summary.CoverUrl, Description: e.Description, Conditions: e.Conditions, CreatedBy: creator, CreatedAt: e.CreatedAt.UTC(), ConfirmedCount: int(row.ConfirmedCount), CanUnpublish: e.PublicationStatus == "PUBLISHED", CanManageParticipants: actor == row.ResponsibleAccountID.String(), OpenEventReportsCount: int(row.OpenEventReportsCount), OpenMessageReportsCount: int(row.OpenMessageReportsCount), EventReportsRevision: int(e.ReportsRevision)}
	if e.PublicationStatus == "UNPUBLISHED" {
		value.Unpublication = &openapi.NullableUnpublication{UnpublishedAt: e.UnpublishedAt.Time.UTC(), UnpublishedBy: uuid.UUID(e.UnpublishedBy.Bytes), Reason: e.UnpublishReason.String}
	}
	return value, nil
}
func (s *Service) AdminGet(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	row, err := db.New(r.Tx).ReadAdminEvent(ctx, uuid.MustParse(r.PathParams["eventId"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, adminMissing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	body, err := s.adminDTO(ctx, r.Tx, row, r.Actor.AccountID)
	return httpapi.Response{Body: body}, err
}
func (s *Service) AdminList(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	query := r.HTTP.URL.Query()
	f, limit, err := parseFilters(query)
	if err != nil {
		return httpapi.Response{}, err
	}
	state := query.Get("publicationStatus")
	if _, ok := query["publicationStatus"]; ok && state != "PUBLISHED" && state != "UNPUBLISHED" {
		return httpapi.Response{}, invalidRequest()
	}
	if strings.ContainsRune(f.Query, 0) {
		return httpapi.Response{}, invalidRequest()
	}
	reports := ""
	var hasReports pgtype.Bool
	if v, ok := query["hasOpenReports"]; ok {
		reports = v[0]
		if reports != "true" && reports != "false" {
			return httpapi.Response{}, invalidRequest()
		}
		hasReports = pgtype.Bool{Bool: reports == "true", Valid: true}
	}
	cursorScope := scope("adminListEvents/"+state+"/"+reports, r.Actor.AccountID, f)
	at, id, err := pageCursor(s, r, cursorScope)
	if err != nil {
		return httpapi.Response{}, err
	}
	rows, err := db.New(r.Tx).ListAdminEvents(ctx, db.ListAdminEventsParams{SearchQuery: f.Query, PublicationStatus: state, OrganizationID: nullableUUID(f.OrganizationID), ActivityTypeID: nullableUUID(f.ActivityTypeID), HasOpenReports: hasReports, CursorTime: at, CursorID: id, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	result := openapi.AdminEventPage{Items: make([]openapi.AdminEvent, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		last := rows[limit-1].Event
		next := s.encodeCursor(cursorScope, last.CreatedAt, last.ID)
		result.NextCursor = &next
		rows = rows[:limit]
	}
	for _, row := range rows {
		value, err := s.adminDTO(ctx, r.Tx, db.ReadAdminEventRow(row), r.Actor.AccountID)
		if err != nil {
			return httpapi.Response{}, err
		}
		result.Items = append(result.Items, value)
	}
	return httpapi.Response{Body: result}, nil
}

// Unpublish is the single domain transition reused by moderation; it takes the
// same event lock as joins/decisions/messages and commits with direct reports.
func (s *Service) Unpublish(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var input openapi.UnpublishInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
		return httpapi.Response{}, err
	}
	reason := strings.TrimSpace(input.Reason)
	if reason == "" || strings.ContainsRune(reason, 0) {
		return httpapi.Response{}, fieldError("/reason")
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["eventId"])
	event, err := q.LockEventForUnpublication(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, adminMissing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if event.PublicationStatus == "UNPUBLISHED" {
		if event.UnpublishReason.String != reason {
			return httpapi.Response{}, fault.New(409, openapi.ErrorCodeDECISIONCONFLICT, "Встреча уже снята с другой причиной. Обновите сведения.")
		}
	} else {
		at := s.clock().UTC()
		actor := pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}
		if err = q.UnpublishEvent(ctx, db.UnpublishEventParams{ID: id, UnpublishedBy: actor, UnpublishedAt: pgtype.Timestamptz{Time: at, Valid: true}, UnpublishReason: pgtype.Text{String: reason, Valid: true}}); err != nil {
			return httpapi.Response{}, err
		}
		if err = q.ResolveOpenEventReports(ctx, db.ResolveOpenEventReportsParams{EventID: id, ReviewedAt: at, ReviewedBy: actor}); err != nil {
			return httpapi.Response{}, err
		}
	}
	return s.AdminGet(ctx, r)
}
