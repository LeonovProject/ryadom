// Package organizations owns profile, submission and approval rules in one transaction.
package organizations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
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
)

type Service struct {
	accounts  *accounts.Service
	cursorKey []byte
	clock     func() time.Time
}

func New(accounts *accounts.Service, secret []byte, clock func() time.Time) (*Service, error) {
	if accounts == nil || len(secret) < 32 || clock == nil {
		return nil, fmt.Errorf("organizations require accounts, a cursor secret and a clock")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("ryadom/organizations/cursor/v1"))
	return &Service{accounts: accounts, cursorKey: mac.Sum(nil), clock: clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, binding := range []struct {
		id      string
		handler httpapi.Handler
	}{
		{"createOrganization", s.create}, {"listMyOrganizations", s.listMine}, {"getMyOrganization", s.getMine}, {"getOrganization", s.getPublic}, {"submitOrganization", s.submit},
	} {
		if err := server.Register(binding.id, binding.handler); err != nil {
			return err
		}
	}
	return nil
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Организация или заявка не найдена.")
}
func validation(field string) error {
	e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Проверьте поля запроса.")
	e.Fields[field] = []string{"Некорректное значение."}
	return e
}
func (s *Service) create(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var input openapi.CreateOrganizationInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
		return httpapi.Response{}, err
	}
	for _, v := range []struct {
		name  string
		value *string
		max   int
	}{{"name", &input.Name, 160}, {"description", &input.Description, 4000}, {"sportInterests", &input.SportInterests, 2000}} {
		*v.value = strings.TrimSpace(*v.value)
		if *v.value == "" || strings.ContainsRune(*v.value, 0) || utf8.RuneCountInString(*v.value) > v.max {
			return httpapi.Response{}, validation("/" + v.name)
		}
	}
	id, err := db.New(r.Tx).InsertOrganization(ctx, db.InsertOrganizationParams{OwnerAccountID: uuid.MustParse(r.Actor.AccountID), Name: input.Name, Description: input.Description, SportInterests: input.SportInterests})
	if err != nil {
		return httpapi.Response{}, err
	}
	body, err := s.Private(ctx, r.Tx, id, r.Actor.AccountID)
	return httpapi.Response{Status: 201, Body: body}, err
}
func (s *Service) Private(ctx context.Context, tx pgx.Tx, id uuid.UUID, viewer string) (openapi.PrivateOrganization, error) {
	row, err := db.New(tx).ReadPrivateOrganization(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return openapi.PrivateOrganization{}, missing()
	}
	if err != nil {
		return openapi.PrivateOrganization{}, err
	}
	return s.privateRow(ctx, tx, row, viewer)
}
func (s *Service) privateRow(ctx context.Context, tx pgx.Tx, row db.ReadPrivateOrganizationRow, viewer string) (openapi.PrivateOrganization, error) {
	o := row.Organization
	owner, err := s.accounts.Public(ctx, tx, o.OwnerAccountID)
	if err != nil {
		return openapi.PrivateOrganization{}, err
	}
	body := openapi.PrivateOrganization{Id: o.ID, Name: o.Name, Description: o.Description, SportInterests: o.SportInterests, CreatedAt: o.CreatedAt.UTC(), UpdatedAt: o.UpdatedAt.UTC(), Owner: owner, ApprovalState: openapi.ApprovalStateNOTSUBMITTED}
	if row.ApplicationID.Valid {
		a := openapi.NullableApplication{Id: uuid.UUID(row.ApplicationID.Bytes), OrganizationId: o.ID, Status: openapi.NullableApplicationStatus(row.ApplicationStatus.String), CreatedAt: row.ApplicationCreatedAt.Time.UTC()}
		if row.ReviewedAt.Valid {
			v := row.ReviewedAt.Time.UTC()
			a.ReviewedAt = &v
		}
		if row.ReviewedBy.Valid {
			v := uuid.UUID(row.ReviewedBy.Bytes)
			a.ReviewedBy = &v
		}
		if row.RejectionReason.Valid {
			a.RejectionReason = &row.RejectionReason.String
		}
		body.Application = &a
		body.ApprovalState = openapi.ApprovalState(row.ApplicationStatus.String)
	}
	own := viewer == o.OwnerAccountID.String() && !owner.IsBlocked
	body.CanSubmit = own && body.Application == nil
	body.CanPublish = own && body.ApprovalState == openapi.ApprovalStateAPPROVED
	return body, nil
}
func (s *Service) getMine(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id := uuid.MustParse(r.PathParams["organizationId"])
	row, err := db.New(r.Tx).ReadPrivateOrganization(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.Organization.OwnerAccountID.String() != r.Actor.AccountID) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	body, err := s.privateRow(ctx, r.Tx, row, r.Actor.AccountID)
	return httpapi.Response{Body: body}, err
}
func (s *Service) getPublic(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	row, err := db.New(r.Tx).ReadPublicOrganization(ctx, uuid.MustParse(r.PathParams["organizationId"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Body: openapi.PublicOrganization{Id: row.ID, Name: row.Name, Description: row.Description, SportInterests: row.SportInterests, CreatedAt: row.CreatedAt.UTC(), OwnerIsBlocked: row.OwnerIsBlocked}}, nil
}
func pageParams(q url.Values) (int, error) {
	if _, ok := q["limit"]; !ok {
		return 20, nil
	}
	limit, err := strconv.Atoi(q.Get("limit"))
	if err != nil || limit < 1 || limit > 100 {
		return 0, fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректный размер страницы.")
	}
	return limit, nil
}
func (s *Service) listMine(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	q := r.HTTP.URL.Query()
	limit, err := pageParams(q)
	if err != nil {
		return httpapi.Response{}, err
	}
	scope := scope("listMyOrganizations", r.Actor.AccountID, filters{})
	at, id, err := s.pageCursor(q, scope)
	if err != nil {
		return httpapi.Response{}, err
	}
	rows, err := db.New(r.Tx).ListOwnedOrganizations(ctx, db.ListOwnedOrganizationsParams{OwnerID: uuid.MustParse(r.Actor.AccountID), CursorTime: at, CursorID: id, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.OrganizationPage{Items: make([]openapi.PrivateOrganization, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		v := s.encodeCursor(scope, rows[limit-1].Organization.CreatedAt, rows[limit-1].Organization.ID)
		body.NextCursor = &v
		rows = rows[:limit]
	}
	for _, row := range rows {
		item, err := s.privateRow(ctx, r.Tx, db.ReadPrivateOrganizationRow(row), r.Actor.AccountID)
		if err != nil {
			return httpapi.Response{}, err
		}
		body.Items = append(body.Items, item)
	}
	return httpapi.Response{Body: body}, nil
}
func applicationDTO(row db.OrganizationApplication) openapi.OrganizationApplication {
	body := openapi.OrganizationApplication{Id: row.ID, OrganizationId: row.OrganizationID, Status: openapi.OrganizationApplicationStatus(row.Status), CreatedAt: row.CreatedAt.UTC()}
	if row.ReviewedAt.Valid {
		v := row.ReviewedAt.Time.UTC()
		body.ReviewedAt = &v
	}
	if row.ReviewedBy.Valid {
		v := uuid.UUID(row.ReviewedBy.Bytes)
		body.ReviewedBy = &v
	}
	if row.RejectionReason.Valid {
		body.RejectionReason = &row.RejectionReason.String
	}
	return body
}
func (s *Service) submit(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	q := db.New(r.Tx)
	org, err := q.LockOrganizationForSubmission(ctx, uuid.MustParse(r.PathParams["organizationId"]))
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && org.OwnerAccountID.String() != r.Actor.AccountID) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	app, err := q.ReadOrganizationApplication(ctx, org.ID)
	if err == nil {
		return httpapi.Response{Body: applicationDTO(app)}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, err
	}
	app, err = q.InsertOrganizationApplication(ctx, db.InsertOrganizationApplicationParams{OrganizationID: org.ID, CreatedAt: s.clock().UTC()})
	if err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Status: 201, Body: applicationDTO(app)}, nil
}
