// Package reports owns complaints and versioned dismissal; content transitions stay in their domains.
package reports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/discussion"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/events"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"time"
)

type Service struct {
	events   *events.Service
	messages *discussion.Service
	clock    func() time.Time
}

func New(e *events.Service, m *discussion.Service, clock func() time.Time) (*Service, error) {
	if e == nil || m == nil || clock == nil {
		return nil, fmt.Errorf("reports require events, discussion and clock")
	}
	return &Service{e, m, clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"reportEvent", s.reportEvent}, {"reportMessage", s.reportMessage}, {"adminDismissEventReports", s.dismissEvent}, {"adminDismissMessageReports", s.dismissMessage}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Встреча или сообщение не найдены.")
}
func (s *Service) published(ctx context.Context, r httpapi.Request, event db.LockDiscussionEventRow) error {
	if event.PublicationStatus == "PUBLISHED" {
		return nil
	}
	_, err := db.New(r.Tx).ReadOwnParticipation(ctx, db.ReadOwnParticipationParams{EventID: event.ID, AccountID: uuid.MustParse(r.Actor.AccountID)})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if event.ResponsibleAccountID.String() == r.Actor.AccountID || r.Actor.Role == openapi.MeSystemRoleADMIN || err == nil {
		return fault.New(409, openapi.ErrorCodeEVENTUNAVAILABLE, "Встреча снята с публикации.")
	}
	return missing()
}
func receipt(r db.Report) (openapi.Report, error) {
	v := openapi.Report{Id: r.ID, CreatedAt: r.CreatedAt.UTC(), Status: openapi.ReportStatus(r.Status)}
	if r.ReviewedAt.Valid {
		at := r.ReviewedAt.Time.UTC()
		v.ReviewedAt = &at
	}
	var err error
	if r.TargetType == "EVENT" {
		err = v.Target.FromEventReportTarget(openapi.EventReportTarget{Id: uuid.UUID(r.TargetEventID.Bytes), Type: "EVENT"})
	} else {
		err = v.Target.FromMessageReportTarget(openapi.MessageReportTarget{Id: uuid.UUID(r.TargetMessageID.Bytes), Type: "MESSAGE"})
	}
	return v, err
}
func result(r db.Report, status int) (httpapi.Response, error) {
	v, err := receipt(r)
	return httpapi.Response{Status: status, Body: v}, err
}
func (s *Service) reportEvent(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["eventId"])
	actor := uuid.MustParse(r.Actor.AccountID)
	e, err := q.LockDiscussionEvent(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if err = s.published(ctx, r, e); err != nil {
		return httpapi.Response{}, err
	}
	if actor == e.ResponsibleAccountID {
		return httpapi.Response{}, fault.New(403, openapi.ErrorCodeCANNOTREPORTOWNCONTENT, "Нельзя пожаловаться на свой контент.")
	}
	old, err := q.ReadOwnEventReport(ctx, db.ReadOwnEventReportParams{ReporterAccountID: actor, TargetEventID: pgtype.UUID{Bytes: id, Valid: true}})
	if err == nil {
		return result(old, 200)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, err
	}
	at := s.clock().UTC()
	saved, err := q.CreateEventReport(ctx, db.CreateEventReportParams{ReporterAccountID: actor, TargetEventID: pgtype.UUID{Bytes: id, Valid: true}, CreatedAt: at})
	if err != nil {
		return httpapi.Response{}, err
	}
	if err = q.IncrementEventReportsRevision(ctx, db.IncrementEventReportsRevisionParams{ID: id, UpdatedAt: at}); err != nil {
		return httpapi.Response{}, err
	}
	return result(saved, 201)
}
func (s *Service) reportMessage(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["messageId"])
	actor := uuid.MustParse(r.Actor.AccountID)
	eid, err := q.FindMessageEvent(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	e, err := q.LockDiscussionEvent(ctx, eid)
	if err != nil {
		return httpapi.Response{}, err
	}
	if err = s.published(ctx, r, e); err != nil {
		return httpapi.Response{}, err
	}
	m, err := q.LockMessage(ctx, id)
	if err != nil {
		return httpapi.Response{}, err
	}
	if actor == m.AuthorAccountID {
		return httpapi.Response{}, fault.New(403, openapi.ErrorCodeCANNOTREPORTOWNCONTENT, "Нельзя пожаловаться на своё сообщение.")
	}
	old, err := q.ReadOwnMessageReport(ctx, db.ReadOwnMessageReportParams{ReporterAccountID: actor, TargetMessageID: pgtype.UUID{Bytes: id, Valid: true}})
	if err == nil {
		return result(old, 200)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, err
	}
	if m.Status != "VISIBLE" {
		return httpapi.Response{}, fault.New(409, openapi.ErrorCodeMESSAGEUNAVAILABLE, "Сообщение скрыто.")
	}
	at := s.clock().UTC()
	saved, err := q.CreateMessageReport(ctx, db.CreateMessageReportParams{ReporterAccountID: actor, TargetMessageID: pgtype.UUID{Bytes: id, Valid: true}, CreatedAt: at})
	if err != nil {
		return httpapi.Response{}, err
	}
	if err = q.IncrementMessageReportsRevision(ctx, db.IncrementMessageReportsRevisionParams{ID: id, UpdatedAt: at}); err != nil {
		return httpapi.Response{}, err
	}
	return result(saved, 201)
}
func (s *Service) dismissEvent(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.ReportDismissInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	id := uuid.MustParse(r.PathParams["eventId"])
	q := db.New(r.Tx)
	if _, err := q.LockEventForUnpublication(ctx, id); errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	} else if err != nil {
		return httpapi.Response{}, err
	}
	row, err := q.ReadAdminEvent(ctx, id)
	if err != nil {
		return httpapi.Response{}, err
	}
	if row.OpenEventReportsCount > 0 {
		if int(row.Event.ReportsRevision) != in.ExpectedReportsRevision {
			return httpapi.Response{}, fault.New(409, openapi.ErrorCodeREPORTSCHANGED, "Поступили новые жалобы. Обновите сведения.")
		}
		if err = q.DismissEventReports(ctx, db.DismissEventReportsParams{TargetID: id, ReviewedAt: s.clock().UTC(), ReviewedBy: pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}}); err != nil {
			return httpapi.Response{}, err
		}
	}
	return s.events.AdminGet(ctx, r)
}
func (s *Service) dismissMessage(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.ReportDismissInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	id := uuid.MustParse(r.PathParams["messageId"])
	q := db.New(r.Tx)
	eid, err := q.FindMessageEvent(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if _, err = q.LockDiscussionEvent(ctx, eid); err != nil {
		return httpapi.Response{}, err
	}
	if _, err = q.LockMessage(ctx, id); err != nil {
		return httpapi.Response{}, err
	}
	row, err := q.ReadAdminMessage(ctx, id)
	if err != nil {
		return httpapi.Response{}, err
	}
	if row.OpenReportsCount > 0 {
		if int(row.Message.ReportsRevision) != in.ExpectedReportsRevision {
			return httpapi.Response{}, fault.New(409, openapi.ErrorCodeREPORTSCHANGED, "Поступили новые жалобы. Обновите сведения.")
		}
		if err = q.DismissMessageReports(ctx, db.DismissMessageReportsParams{TargetID: id, ReviewedAt: s.clock().UTC(), ReviewedBy: pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}}); err != nil {
			return httpapi.Response{}, err
		}
	}
	return s.messages.AdminGet(ctx, r)
}
