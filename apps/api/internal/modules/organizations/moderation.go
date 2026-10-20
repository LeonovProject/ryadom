package organizations

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (s *Service) AdminList(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	query := r.HTTP.URL.Query()
	limit, err := pageParams(query)
	if err != nil {
		return httpapi.Response{}, err
	}
	f := filters{Query: strings.ToLower(strings.Join(strings.Fields(query.Get("q")), " ")), ApprovalState: query.Get("approvalState")}
	scope := scope("adminListOrganizations", r.Actor.AccountID, f)
	at, id, err := s.pageCursor(query, scope)
	if err != nil {
		return httpapi.Response{}, err
	}
	rows, err := db.New(r.Tx).ListAdminOrganizations(ctx, db.ListAdminOrganizationsParams{SearchQuery: f.Query, ApprovalState: f.ApprovalState, CursorTime: at, CursorID: id, PageSize: int32(limit + 1)})
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
func (s *Service) AdminGet(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	body, err := s.Private(ctx, r.Tx, uuid.MustParse(r.PathParams["organizationId"]), r.Actor.AccountID)
	return httpapi.Response{Body: body}, err
}

// Decide is the sole organization approval rule. The moderation module only binds
// its canonical ADMIN route; submitting/publishing use the same application row.
func (s *Service) Decide(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var input struct {
		Decision string `json:"decision"`
		Reason   string `json:"reason"`
	}
	if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
		return httpapi.Response{}, err
	}
	reason := strings.TrimSpace(input.Reason)
	if input.Decision == "REJECT" && (reason == "" || strings.ContainsRune(reason, 0) || utf8.RuneCountInString(reason) > 2000) {
		return httpapi.Response{}, validation("/reason")
	}
	state := "APPROVED"
	if input.Decision == "REJECT" {
		state = "REJECTED"
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["applicationId"])
	orgID, err := q.FindApplicationOrganization(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	// Organization precedes application in both submission and publication paths.
	if _, err = q.LockOrganizationForSubmission(ctx, orgID); err != nil {
		return httpapi.Response{}, err
	}
	app, err := q.LockOrganizationApplication(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if app.Status != "PENDING" {
		if app.Status == state && (state == "APPROVED" || app.RejectionReason.String == reason) {
			return httpapi.Response{Body: applicationDTO(app)}, nil
		}
		return httpapi.Response{}, fault.New(409, openapi.ErrorCodeDECISIONCONFLICT, "По заявке уже принято другое решение.")
	}
	var rejection pgtype.Text
	if state == "REJECTED" {
		rejection = pgtype.Text{String: reason, Valid: true}
	}
	app, err = q.DecideOrganizationApplication(ctx, db.DecideOrganizationApplicationParams{ID: id, Status: state, ReviewedBy: pgtype.UUID{Bytes: uuid.MustParse(r.Actor.AccountID), Valid: true}, ReviewedAt: pgtype.Timestamptz{Time: s.clock().UTC(), Valid: true}, RejectionReason: rejection})
	if err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Body: applicationDTO(app)}, nil
}
