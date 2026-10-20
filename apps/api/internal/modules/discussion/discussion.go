// Package discussion owns public messages and their moderation transitions.
package discussion

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

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

func New(accounts *accounts.Service, secret []byte, clock func() time.Time) (*Service, error) {
	if accounts == nil || len(secret) < 32 || clock == nil {
		return nil, fmt.Errorf("discussion requires accounts, secret and clock")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("ryadom/discussion/cursor/v1"))
	return &Service{accounts: accounts, cursorKey: mac.Sum(nil), clock: clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"listMessages", s.list}, {"createMessage", s.create}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Встреча или сообщение не найдены.")
}
func invalidRequest() error {
	return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректные параметры списка.")
}
func invalidCursor() error {
	return fault.New(400, openapi.ErrorCodeINVALIDCURSOR, "Курсор не соответствует списку. Начните с первой страницы.")
}
func (s *Service) create(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var input openapi.CreateMessageInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
		return httpapi.Response{}, err
	}
	body := strings.TrimSpace(input.Body)
	if body == "" || strings.ContainsRune(body, 0) || utf8.RuneCountInString(body) > 4000 {
		e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Проверьте текст сообщения.")
		e.Fields["body"] = []string{"Введите текст длиной до 4000 символов."}
		return httpapi.Response{}, e
	}
	q := db.New(r.Tx)
	actor := uuid.MustParse(r.Actor.AccountID)
	event, err := q.LockDiscussionEvent(ctx, uuid.MustParse(r.PathParams["eventId"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if event.PublicationStatus != "PUBLISHED" {
		// Unpublished resources are disclosed only to their existing authorized readers.
		_, e := q.ReadOwnParticipation(ctx, db.ReadOwnParticipationParams{EventID: event.ID, AccountID: actor})
		if e != nil && !errors.Is(e, pgx.ErrNoRows) {
			return httpapi.Response{}, e
		}
		if actor != event.ResponsibleAccountID && r.Actor.Role != openapi.MeSystemRoleADMIN && errors.Is(e, pgx.ErrNoRows) {
			return httpapi.Response{}, missing()
		}
		return httpapi.Response{}, fault.New(409, openapi.ErrorCodeEVENTUNAVAILABLE, "Встреча снята с публикации.")
	}
	m, err := q.InsertMessage(ctx, db.InsertMessageParams{EventID: event.ID, AuthorAccountID: actor, Body: body, CreatedAt: s.clock().UTC()})
	if err != nil {
		return httpapi.Response{}, err
	}
	author, err := s.accounts.Public(ctx, r.Tx, actor)
	if err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Status: 201, Body: openapi.VisibleMessage{Id: m.ID, EventId: m.EventID, Author: author, AuthorIsOrganizer: actor == event.ResponsibleAccountID, CreatedAt: m.CreatedAt.UTC(), Status: "VISIBLE", Body: m.Body}}, nil
}
func (s *Service) adminDTO(ctx context.Context, tx pgx.Tx, row db.ReadAdminMessageRow) (openapi.AdminMessage, error) {
	m := row.Message
	author, err := s.accounts.Public(ctx, tx, m.AuthorAccountID)
	if err != nil {
		return openapi.AdminMessage{}, err
	}
	value := openapi.AdminMessage{Id: m.ID, EventId: m.EventID, Author: author, AuthorIsOrganizer: row.AuthorIsOrganizer, CreatedAt: m.CreatedAt.UTC(), Status: openapi.AdminMessageStatus(m.Status), Body: m.Body, ModerationRevision: int(m.ModerationRevision), ReportsRevision: int(m.ReportsRevision), OpenReportsCount: int(row.OpenReportsCount)}
	if m.HiddenAt.Valid {
		at := m.HiddenAt.Time.UTC()
		value.HiddenAt = &at
	}
	if m.HiddenBy.Valid {
		id := uuid.UUID(m.HiddenBy.Bytes)
		value.HiddenBy = &id
	}
	if m.RestoredAt.Valid {
		at := m.RestoredAt.Time.UTC()
		value.RestoredAt = &at
	}
	if m.RestoredBy.Valid {
		id := uuid.UUID(m.RestoredBy.Bytes)
		value.RestoredBy = &id
	}
	return value, nil
}

// Hide serializes content/report decisions using the common event -> message order.
func (s *Service) Hide(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var input openapi.MessageModerationInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
		return httpapi.Response{}, err
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["messageId"])
	eventID, err := q.FindMessageEvent(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if _, err = q.LockDiscussionEvent(ctx, eventID); err != nil {
		return httpapi.Response{}, err
	}
	m, err := q.LockMessage(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	// An already hidden target is a safe repeat, even with an old revision.
	if m.Status != "HIDDEN" {
		if int(m.ModerationRevision) != input.ExpectedRevision {
			return httpapi.Response{}, fault.New(409, openapi.ErrorCodeMESSAGECHANGED, "Сообщение изменилось. Обновите сведения.")
		}
		at := s.clock().UTC()
		actor := pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}
		if err = q.HideMessage(ctx, db.HideMessageParams{ID: id, HiddenAt: pgtype.Timestamptz{Time: at, Valid: true}, HiddenBy: actor}); err != nil {
			return httpapi.Response{}, err
		}
		if err = q.ResolveOpenMessageReports(ctx, db.ResolveOpenMessageReportsParams{MessageID: id, ReviewedAt: at, ReviewedBy: actor}); err != nil {
			return httpapi.Response{}, err
		}
	}
	row, err := q.ReadAdminMessage(ctx, id)
	if err != nil {
		return httpapi.Response{}, err
	}
	result, err := s.adminDTO(ctx, r.Tx, row)
	return httpapi.Response{Body: result}, err
}
