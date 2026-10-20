package discussion

import (
	"context"
	"errors"
	"net/url"
	"strconv"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type page struct {
	limit   int
	scope   string
	time    pgtype.Timestamptz
	id      pgtype.UUID
	newest  bool
	reports pgtype.Bool
}

func (s *Service) page(query url.Values, route, actor, event string, admin bool) (page, error) {
	p := page{limit: 20}
	order := "OLDEST_FIRST"
	reports := ""
	if v, ok := query["limit"]; ok {
		n, e := strconv.Atoi(v[0])
		if e != nil || n < 1 || n > 100 {
			return p, invalidRequest()
		}
		p.limit = n
	}
	if !admin {
		if v, ok := query["order"]; ok {
			order = v[0]
		}
		if order != "OLDEST_FIRST" && order != "NEWEST_FIRST" {
			return p, invalidRequest()
		}
		p.newest = order == "NEWEST_FIRST"
	}
	if admin {
		if v, ok := query["hasOpenReports"]; ok {
			reports = v[0]
			if reports != "true" && reports != "false" {
				return p, invalidRequest()
			}
			p.reports = pgtype.Bool{Bool: reports == "true", Valid: true}
		}
	}
	p.scope = scope(route, actor, event, order, reports)
	if v, ok := query["cursor"]; ok {
		c, e := s.decodeCursor(v[0], p.scope)
		if e != nil {
			return p, e
		}
		p.time = pgtype.Timestamptz{Time: c.Time, Valid: true}
		p.id = pgtype.UUID{Bytes: c.ID, Valid: true}
	}
	return p, nil
}
func (s *Service) publication(ctx context.Context, q *db.Queries, id uuid.UUID, admin bool) error {
	state, err := q.ReadDiscussionPublication(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return missing()
	}
	if err != nil {
		return err
	}
	if !admin && state != "PUBLISHED" {
		return missing()
	}
	return nil
}
func (s *Service) list(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id := uuid.MustParse(r.PathParams["eventId"])
	q := db.New(r.Tx)
	if err := s.publication(ctx, q, id, false); err != nil {
		return httpapi.Response{}, err
	}
	p, err := s.page(r.HTTP.URL.Query(), "listMessages", "", id.String(), false)
	if err != nil {
		return httpapi.Response{}, err
	}
	rows, err := q.ListPublicMessages(ctx, db.ListPublicMessagesParams{EventID: id, CursorTime: p.time, CursorID: p.id, NewestFirst: p.newest, PageSize: int32(p.limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	result := openapi.MessagePage{Items: make([]openapi.PublicMessage, 0, min(len(rows), p.limit))}
	if len(rows) > p.limit {
		last := rows[p.limit-1]
		next := s.encodeCursor(p.scope, last.CreatedAt, last.ID)
		result.NextCursor = &next
		rows = rows[:p.limit]
	}
	for _, m := range rows {
		author, err := s.accounts.Public(ctx, r.Tx, m.AuthorAccountID)
		if err != nil {
			return httpapi.Response{}, err
		}
		var message openapi.PublicMessage
		if m.Status == "HIDDEN" {
			err = message.FromHiddenMessage(openapi.HiddenMessage{Id: m.ID, EventId: m.EventID, Author: author, AuthorIsOrganizer: m.AuthorIsOrganizer, CreatedAt: m.CreatedAt.UTC(), Status: "HIDDEN"})
		} else {
			err = message.FromVisibleMessage(openapi.VisibleMessage{Id: m.ID, EventId: m.EventID, Author: author, AuthorIsOrganizer: m.AuthorIsOrganizer, CreatedAt: m.CreatedAt.UTC(), Status: "VISIBLE", Body: m.Body})
		}
		if err != nil {
			return httpapi.Response{}, err
		}
		result.Items = append(result.Items, message)
	}
	return httpapi.Response{Body: result}, nil
}
func (s *Service) AdminList(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id := uuid.MustParse(r.PathParams["eventId"])
	q := db.New(r.Tx)
	if err := s.publication(ctx, q, id, true); err != nil {
		return httpapi.Response{}, err
	}
	p, err := s.page(r.HTTP.URL.Query(), "adminListMessages", r.Actor.AccountID, id.String(), true)
	if err != nil {
		return httpapi.Response{}, err
	}
	rows, err := q.ListAdminMessages(ctx, db.ListAdminMessagesParams{EventID: id, HasOpenReports: p.reports, CursorTime: p.time, CursorID: p.id, PageSize: int32(p.limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	result := openapi.AdminMessagePage{Items: make([]openapi.AdminMessage, 0, min(len(rows), p.limit))}
	if len(rows) > p.limit {
		last := rows[p.limit-1].Message
		next := s.encodeCursor(p.scope, last.CreatedAt, last.ID)
		result.NextCursor = &next
		rows = rows[:p.limit]
	}
	for _, row := range rows {
		value, err := s.adminDTO(ctx, r.Tx, db.ReadAdminMessageRow(row))
		if err != nil {
			return httpapi.Response{}, err
		}
		result.Items = append(result.Items, value)
	}
	return httpapi.Response{Body: result}, nil
}
