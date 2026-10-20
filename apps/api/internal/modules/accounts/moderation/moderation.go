// Package moderation owns administrator account search and status transitions.
package moderation

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
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
type filters struct{ Query, Status string }

func New(a *accounts.Service, secret []byte, clock func() time.Time) (*Service, error) {
	if a == nil || len(secret) < 32 || clock == nil {
		return nil, fmt.Errorf("account moderation requires accounts, key and clock")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("ryadom/account-moderation/cursor/v1"))
	return &Service{a, mac.Sum(nil), clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"adminListAccounts", s.list}, {"adminGetAccount", s.get}, {"adminSetAccountStatus", s.setStatus}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Аккаунт не найден.")
}
func invalidRequest() error {
	return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректные фильтры.")
}
func invalidCursor() error {
	return fault.New(400, openapi.ErrorCodeINVALIDCURSOR, "Курсор не соответствует списку. Начните с первой страницы.")
}
func (s *Service) dto(row db.ReadAdminAccountRow) openapi.AdminAccount {
	account := s.accounts.PublicFromRow(db.ReadPublicAccountRow{ID: row.ID, DisplayName: row.DisplayName, IsBlocked: row.Status == "BLOCKED", AvatarSource: row.AvatarSource, AvatarStatus: row.AvatarStatus, AvatarRevision: row.AvatarRevision, PresetID: row.PresetID})
	v := openapi.AdminAccount{Account: account, Email: openapi.Email(row.Email), SystemRole: openapi.AdminAccountSystemRole(row.SystemRole), Status: openapi.AccountStatus(row.Status), Revision: int(row.Revision), CreatedAt: row.CreatedAt.UTC()}
	if row.BlockedAt.Valid {
		at := row.BlockedAt.Time.UTC()
		v.BlockedAt = &at
	}
	if row.BlockedByAccountID.Valid {
		id := uuid.UUID(row.BlockedByAccountID.Bytes)
		v.BlockedByAccountId = &id
	}
	return v
}
func (s *Service) get(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	row, err := db.New(r.Tx).ReadAdminAccount(ctx, uuid.MustParse(r.PathParams["accountId"]))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	return httpapi.Response{Body: s.dto(row)}, nil
}
func (s *Service) list(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	query := r.HTTP.URL.Query()
	f := filters{Query: strings.ToLower(strings.Join(strings.Fields(query.Get("q")), " ")), Status: query.Get("status")}
	limit := 20
	if strings.ContainsRune(f.Query, 0) {
		return httpapi.Response{}, invalidRequest()
	}
	if _, ok := query["status"]; ok && f.Status != "ACTIVE" && f.Status != "BLOCKED" {
		return httpapi.Response{}, invalidRequest()
	}
	if v, ok := query["limit"]; ok {
		n, e := strconv.Atoi(v[0])
		if e != nil || n < 1 || n > 100 {
			return httpapi.Response{}, invalidRequest()
		}
		limit = n
	}
	var exact, afterID pgtype.UUID
	var after pgtype.Timestamptz
	if id, e := uuid.Parse(f.Query); e == nil {
		exact = pgtype.UUID{Bytes: id, Valid: true}
	}
	sc := scope("adminListAccounts", r.Actor.AccountID, f)
	if v, ok := query["cursor"]; ok {
		c, e := s.decodeCursor(v[0], sc)
		if e != nil {
			return httpapi.Response{}, e
		}
		after = pgtype.Timestamptz{Time: c.Time, Valid: true}
		afterID = pgtype.UUID{Bytes: c.ID, Valid: true}
	}
	rows, err := db.New(r.Tx).ListAdminAccounts(ctx, db.ListAdminAccountsParams{SearchQuery: f.Query, AccountStatus: f.Status, ExactID: exact, CursorTime: after, CursorID: afterID, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	body := openapi.AdminAccountPage{Items: make([]openapi.AdminAccount, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		last := rows[limit-1]
		next := s.encodeCursor(sc, last.CreatedAt, last.ID)
		body.NextCursor = &next
		rows = rows[:limit]
	}
	for _, row := range rows {
		body.Items = append(body.Items, s.dto(db.ReadAdminAccountRow(row)))
	}
	return httpapi.Response{Body: body}, nil
}
func (s *Service) setStatus(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.AccountStatusInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	q := db.New(r.Tx)
	id := uuid.MustParse(r.PathParams["accountId"])
	// The authenticated ADMIN's FOR SHARE is held by Runner. Reject an ADMIN target
	// before any exclusive target lock, including reciprocal administrator requests.
	role, err := q.ReadModerationTargetRole(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if role != "USER" {
		return httpapi.Response{}, fault.New(409, openapi.ErrorCodeACCOUNTPROTECTED, "Аккаунт администратора защищён.")
	}
	target, err := q.LockModeratedUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if int(target.Revision) != in.ExpectedRevision {
		return httpapi.Response{}, fault.New(409, openapi.ErrorCodeACCOUNTREVISIONCONFLICT, "Состояние аккаунта изменилось. Обновите сведения.")
	}
	if target.Status != string(in.Status) {
		if err = q.SetModeratedAccountStatus(ctx, db.SetModeratedAccountStatusParams{AccountID: id, AccountStatus: string(in.Status), ChangedAt: s.clock().UTC(), ChangedBy: uuid.MustParse(r.Actor.AccountID)}); err != nil {
			return httpapi.Response{}, err
		}
		if in.Status == "BLOCKED" {
			if err = q.RevokeAccountSessions(ctx, id); err != nil {
				return httpapi.Response{}, err
			}
		}
	}
	return s.get(ctx, r)
}
