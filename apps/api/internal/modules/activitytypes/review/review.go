// Package review implements one-time catalog decisions and renaming.
package review

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/unicode/norm"
	"strconv"
	"strings"
	"time"
)

type Service struct {
	accounts  *accounts.Service
	cursorKey []byte
	clock     func() time.Time
}
type filters struct{ Query, Status string }

func New(a *accounts.Service, secret []byte, clock func() time.Time) (*Service, error) {
	if a == nil || len(secret) < 32 || clock == nil {
		return nil, fmt.Errorf("activity review requires accounts, key and clock")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("ryadom/activity-review/cursor/v1"))
	return &Service{a, mac.Sum(nil), clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"adminListActivityTypes", s.list}, {"adminGetActivityType", s.get}, {"adminDecideActivityType", s.decide}, {"adminRenameActivityType", s.rename}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func invalidCursor() error {
	return fault.New(400, openapi.ErrorCodeINVALIDCURSOR, "Курсор не соответствует списку.")
}
func invalidRequest() error {
	return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректные фильтры.")
}
func conflict(code openapi.ErrorCode) error {
	return fault.New(409, code, "Направление изменилось или имя занято. Обновите сведения.")
}
func field(name string) error {
	e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Проверьте поля.")
	e.Fields[name] = []string{"Некорректное значение."}
	return e
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Направление не найдено.")
}
func unique(err error) error {
	var p *pgconn.PgError
	if errors.As(err, &p) && p.Code == "23505" {
		return conflict(openapi.ErrorCodeACTIVITYTYPENAMECONFLICT)
	}
	return err
}
func (s *Service) dto(ctx context.Context, tx pgx.Tx, row db.ReadAdminActivityRow) (openapi.AdminActivityType, error) {
	t := row.ActivityType
	v := openapi.AdminActivityType{Id: t.ID, Name: t.Name, CatalogStatus: openapi.ActivityTypeCatalogStatus(t.CatalogStatus), IsSeeded: t.IsSeeded, CreatedAt: t.CreatedAt.UTC(), UpdatedAt: t.UpdatedAt.UTC(), EventCount: int(row.EventCount), CanDecide: t.CatalogStatus == "PENDING"}
	if t.CreatedByAccountID.Valid {
		a, err := s.accounts.Public(ctx, tx, uuid.UUID(t.CreatedByAccountID.Bytes))
		if err != nil {
			return v, err
		}
		n := openapi.NullablePublicAccount(a)
		v.CreatedBy = &n
	}
	if t.ReviewedByAccountID.Valid {
		a, err := s.accounts.Public(ctx, tx, uuid.UUID(t.ReviewedByAccountID.Bytes))
		if err != nil {
			return v, err
		}
		n := openapi.NullablePublicAccount(a)
		v.ReviewedBy = &n
	}
	if t.ReviewedAt.Valid {
		at := t.ReviewedAt.Time.UTC()
		v.ReviewedAt = &at
	}
	if t.RejectionReason.Valid {
		v.RejectionReason = &t.RejectionReason.String
	}
	return v, nil
}
func (s *Service) get(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	row, err := db.New(r.Tx).ReadAdminActivity(ctx, uuid.MustParse(r.PathParams["activityTypeId"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	v, err := s.dto(ctx, r.Tx, row)
	return httpapi.Response{Body: v}, err
}
func (s *Service) list(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	q := r.HTTP.URL.Query()
	f := filters{strings.ToLower(strings.Join(strings.Fields(norm.NFC.String(q.Get("q"))), " ")), q.Get("catalogStatus")}
	limit := 20
	if _, ok := q["catalogStatus"]; ok && f.Status != "PENDING" && f.Status != "APPROVED" && f.Status != "REJECTED" {
		return httpapi.Response{}, invalidRequest()
	}
	if strings.ContainsRune(f.Query, 0) {
		return httpapi.Response{}, invalidRequest()
	}
	if v, ok := q["limit"]; ok {
		n, e := strconv.Atoi(v[0])
		if e != nil || n < 1 || n > 100 {
			return httpapi.Response{}, invalidRequest()
		}
		limit = n
	}
	sc := scope("adminListActivityTypes", r.Actor.AccountID, f)
	var at pgtype.Timestamptz
	var id pgtype.UUID
	if v, ok := q["cursor"]; ok {
		c, e := s.decodeCursor(v[0], sc)
		if e != nil {
			return httpapi.Response{}, e
		}
		at = pgtype.Timestamptz{Time: c.Time, Valid: true}
		id = pgtype.UUID{Bytes: c.ID, Valid: true}
	}
	rows, err := db.New(r.Tx).ListAdminActivities(ctx, db.ListAdminActivitiesParams{SearchQuery: f.Query, CatalogStatus: f.Status, CursorTime: at, CursorID: id, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.AdminActivityTypePage{Items: make([]openapi.AdminActivityType, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		last := rows[limit-1].ActivityType
		next := s.encodeCursor(sc, last.CreatedAt, last.ID)
		body.NextCursor = &next
		rows = rows[:limit]
	}
	for _, row := range rows {
		v, e := s.dto(ctx, r.Tx, db.ReadAdminActivityRow(row))
		if e != nil {
			return httpapi.Response{}, e
		}
		body.Items = append(body.Items, v)
	}
	return httpapi.Response{Body: body}, nil
}
func (s *Service) rename(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.RenameActivityTypeInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	name, key, valid := activitytypes.NormalizeName(in.Name)
	if !valid {
		return httpapi.Response{}, field("name")
	}
	expected, _, valid := activitytypes.NormalizeName(in.ExpectedName)
	if !valid {
		return httpapi.Response{}, field("expectedName")
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["activityTypeId"])
	t, err := q.LockActivityReview(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if t.Name != name {
		if t.Name != expected {
			return httpapi.Response{}, conflict(openapi.ErrorCodeACTIVITYTYPECHANGED)
		}
		if err = q.RenameActivity(ctx, db.RenameActivityParams{ID: id, Name: name, NormalizedName: key, UpdatedAt: s.clock().UTC()}); err != nil {
			return httpapi.Response{}, unique(err)
		}
	}
	return s.get(ctx, r)
}
func (s *Service) decide(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in struct {
		Decision, ExpectedName string
		Name                   *string
		Reason                 string
	}
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	expected, _, valid := activitytypes.NormalizeName(in.ExpectedName)
	if !valid {
		return httpapi.Response{}, field("expectedName")
	}
	var name, key string
	if in.Name != nil {
		name, key, valid = activitytypes.NormalizeName(*in.Name)
		if !valid {
			return httpapi.Response{}, field("name")
		}
	}
	reason := strings.TrimSpace(in.Reason)
	if in.Decision == "REJECT" && (reason == "" || strings.ContainsRune(reason, 0)) {
		return httpapi.Response{}, field("reason")
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["activityTypeId"])
	t, err := q.LockActivityReview(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	status := "APPROVED"
	if in.Decision == "REJECT" {
		status = "REJECTED"
	}
	if t.CatalogStatus != "PENDING" {
		if t.CatalogStatus != status || (in.Name != nil && name != t.Name) || (status == "REJECTED" && reason != t.RejectionReason.String) {
			return httpapi.Response{}, conflict(openapi.ErrorCodeDECISIONCONFLICT)
		}
		return s.get(ctx, r)
	}
	if t.Name != expected {
		return httpapi.Response{}, conflict(openapi.ErrorCodeACTIVITYTYPECHANGED)
	}
	if in.Name == nil {
		name, key = t.Name, t.NormalizedName
	}
	if err = q.DecideActivity(ctx, db.DecideActivityParams{ID: id, Name: name, NormalizedName: key, CatalogStatus: status, ReviewedByAccountID: pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}, ReviewedAt: pgtype.Timestamptz{Time: s.clock().UTC(), Valid: true}, RejectionReason: pgtype.Text{String: reason, Valid: status == "REJECTED"}}); err != nil {
		return httpapi.Response{}, unique(err)
	}
	return s.get(ctx, r)
}
