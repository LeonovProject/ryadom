// Package avatar implements personal SVG replacement and revision-bound moderation.
package avatar

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
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/svg"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct {
	accounts  *accounts.Service
	catalog   *avatarpresets.Catalog
	cursorKey []byte
	clock     func() time.Time
}
type filters struct{ Query, Status string }

func New(a *accounts.Service, catalog *avatarpresets.Catalog, secret []byte, clock func() time.Time) (*Service, error) {
	if a == nil || catalog == nil || len(secret) < 32 || clock == nil {
		return nil, fmt.Errorf("avatars require accounts, catalog, key and clock")
	}
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte("ryadom/avatar/cursor/v1"))
	return &Service{a, catalog, mac.Sum(nil), clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{
		{"getMyAvatar", s.getMine}, {"uploadAvatar", s.upload}, {"deleteMyAvatar", s.remove}, {"selectPresetAvatar", s.preset},
		{"getAccountAvatar", s.publicImage}, {"getMyAvatarImage", s.myImage}, {"adminGetAvatarImage", s.adminImage},
		{"adminListAvatars", s.list}, {"adminGetAvatar", s.getAdmin}, {"adminModerateAvatar", s.moderate},
	} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func missing() error {
	return fault.New(404, openapi.ErrorCodeNOTFOUND, "Аватар не найден.")
}
func changed() error {
	return fault.New(409, openapi.ErrorCodeAVATARCHANGED, "Аватар изменился. Обновите сведения.")
}
func invalidCursor() error {
	return fault.New(400, openapi.ErrorCodeINVALIDCURSOR, "Курсор не соответствует списку.")
}
func invalidRequest() error {
	return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректные фильтры.")
}
func actorID(r httpapi.Request) uuid.UUID  { return uuid.MustParse(r.Actor.AccountID) }
func targetID(r httpapi.Request) uuid.UUID { return uuid.MustParse(r.PathParams["accountId"]) }
func read(ctx context.Context, q *db.Queries, id uuid.UUID) (db.AccountAvatar, error) {
	v, err := q.ReadAvatar(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		at, e := q.ReadAvatarOrigin(ctx, id)
		if errors.Is(e, pgx.ErrNoRows) {
			return v, missing()
		}
		return db.AccountAvatar{AccountID: id, Source: "NONE", Status: "EMPTY", CreatedAt: at, UpdatedAt: at}, e
	}
	return v, err
}
func instant(at pgtype.Timestamptz) *time.Time {
	if !at.Valid {
		return nil
	}
	v := at.Time.UTC()
	return &v
}
func (s *Service) state(v db.AccountAvatar) openapi.AvatarState {
	out := openapi.AvatarState{AccountId: v.AccountID, Source: openapi.AvatarSource(v.Source), Status: openapi.AvatarStatus(v.Status), Revision: int(v.Revision), UpdatedAt: v.UpdatedAt.UTC(), UploadedAt: instant(v.UploadedAt), ReviewedAt: instant(v.ReviewedAt)}
	if v.PresetID.Valid {
		out.PresetId = &v.PresetID.String
		if url, ok := s.catalog.URL(v.PresetID.String); ok {
			out.PreviewUrl = &url
		}
	} else if v.Source == "CUSTOM" {
		url := fmt.Sprintf("/api/v1/me/avatar/image?revision=%d", v.Revision)
		out.PreviewUrl = &url
	}
	return out
}
func (s *Service) getMine(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	v, err := read(ctx, db.New(r.Tx), actorID(r))
	return httpapi.Response{Body: s.state(v)}, err
}

// Runner holds the owner's accounts FOR SHARE before this row lock. Missing
// legacy/seed rows become a persisted EMPTY without resetting their revision.
func lockMine(ctx context.Context, r httpapi.Request) (db.AccountAvatar, error) {
	q := db.New(r.Tx)
	if err := q.EnsureEmptyAvatar(ctx, actorID(r)); err != nil {
		return db.AccountAvatar{}, err
	}
	return q.LockAvatar(ctx, actorID(r))
}
func (s *Service) replace(ctx context.Context, r httpapi.Request, source, preset, document string) error {
	var uploaded pgtype.Timestamptz
	now := s.clock().UTC()
	if source == "CUSTOM" {
		uploaded = pgtype.Timestamptz{Time: now, Valid: true}
	}
	return db.New(r.Tx).ReplaceAvatar(ctx, db.ReplaceAvatarParams{AccountID: actorID(r), Source: source, PresetID: pgtype.Text{String: preset, Valid: source == "PRESET"}, Svg: pgtype.Text{String: document, Valid: source == "CUSTOM"}, Status: map[string]string{"NONE": "EMPTY", "PRESET": "APPROVED", "CUSTOM": "PENDING"}[source], UploadedAt: uploaded, UpdatedAt: now})
}
func (s *Service) upload(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.AvatarUploadInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	document, err := svg.Normalize(in.Svg)
	if err != nil {
		return httpapi.Response{}, err
	}
	v, err := lockMine(ctx, r)
	if err != nil {
		return httpapi.Response{}, err
	}
	if v.Source == "CUSTOM" && v.Status == "PENDING" && v.Svg.String == document {
		return httpapi.Response{Body: s.state(v)}, nil
	}
	if int(v.Revision) != in.ExpectedRevision {
		return httpapi.Response{}, changed()
	}
	if err = s.replace(ctx, r, "CUSTOM", "", document); err != nil {
		return httpapi.Response{}, err
	}
	return s.getMine(ctx, r)
}
func (s *Service) preset(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.PresetAvatarInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	if _, ok := s.catalog.URL(in.PresetId); !ok {
		e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Готовый аватар недоступен.")
		e.Fields["/presetId"] = []string{"Выберите аватар из текущего каталога."}
		return httpapi.Response{}, e
	}
	v, err := lockMine(ctx, r)
	if err != nil {
		return httpapi.Response{}, err
	}
	if v.Source == "PRESET" && v.PresetID.String == in.PresetId {
		return httpapi.Response{Body: s.state(v)}, nil
	}
	if int(v.Revision) != in.ExpectedRevision {
		return httpapi.Response{}, changed()
	}
	if err = s.replace(ctx, r, "PRESET", in.PresetId, ""); err != nil {
		return httpapi.Response{}, err
	}
	return s.getMine(ctx, r)
}
func (s *Service) remove(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.AvatarRevisionInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	v, err := lockMine(ctx, r)
	if err != nil {
		return httpapi.Response{}, err
	}
	if v.Source == "NONE" {
		return httpapi.Response{Body: s.state(v)}, nil
	}
	if int(v.Revision) != in.ExpectedRevision {
		return httpapi.Response{}, changed()
	}
	if err = s.replace(ctx, r, "NONE", "", ""); err != nil {
		return httpapi.Response{}, err
	}
	return s.getMine(ctx, r)
}
func image(v db.AccountAvatar, r httpapi.Request, public bool) (httpapi.Response, error) {
	revision, err := strconv.Atoi(r.HTTP.URL.Query().Get("revision"))
	if err != nil || v.Source != "CUSTOM" || int(v.Revision) != revision || !v.Svg.Valid || (public && v.Status != "APPROVED") {
		return httpapi.Response{}, missing()
	}
	return httpapi.SVG(v.Svg.String), nil
}
func (s *Service) publicImage(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	v, err := read(ctx, db.New(r.Tx), targetID(r))
	if err != nil {
		return httpapi.Response{}, err
	}
	return image(v, r, true)
}
func (s *Service) myImage(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	v, err := read(ctx, db.New(r.Tx), actorID(r))
	if err != nil {
		return httpapi.Response{}, err
	}
	return image(v, r, false)
}
func (s *Service) adminImage(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	v, err := read(ctx, db.New(r.Tx), targetID(r))
	if err != nil {
		return httpapi.Response{}, err
	}
	return image(v, r, false)
}
func (s *Service) adminDTO(row db.ReadAdminAvatarRow) openapi.AdminAvatar {
	v := row.AccountAvatar
	account := s.accounts.PublicFromRow(db.ReadPublicAccountRow{ID: v.AccountID, DisplayName: row.DisplayName, IsBlocked: row.IsBlocked, AvatarSource: v.Source, AvatarStatus: v.Status, AvatarRevision: v.Revision, PresetID: v.PresetID})
	url := fmt.Sprintf("/api/v1/admin/accounts/%s/avatar/image?revision=%d", v.AccountID, v.Revision)
	out := openapi.AdminAvatar{Account: account, Status: openapi.AvatarStatus(v.Status), Revision: int(v.Revision), UploadedAt: instant(v.UploadedAt), ReviewedAt: instant(v.ReviewedAt), UpdatedAt: v.UpdatedAt.UTC(), PreviewUrl: &url}
	if v.ReviewedBy.Valid {
		id := uuid.UUID(v.ReviewedBy.Bytes)
		out.ReviewedBy = &id
	}
	return out
}
func (s *Service) getAdmin(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	v, err := db.New(r.Tx).ReadAdminAvatar(ctx, targetID(r))
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	return httpapi.Response{Body: s.adminDTO(v)}, err
}
func (s *Service) moderate(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.AvatarModerationInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	q := db.New(r.Tx)
	id := targetID(r)
	// A share lock protects the target account before the avatar lock, including
	// blocked accounts. Moderation never changes account status or sessions.
	if _, err := q.LockSessionActor(ctx, id); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			err = missing()
		}
		return httpapi.Response{}, err
	}
	v, err := q.LockAvatar(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, missing()
	}
	if err != nil {
		return httpapi.Response{}, err
	}
	if v.Source != "CUSTOM" {
		return httpapi.Response{}, missing()
	}
	status := "APPROVED"
	if in.Decision == "HIDE" {
		status = "HIDDEN"
	}
	if v.Status == status {
		if in.ExpectedRevision != int(v.Revision) && in.ExpectedRevision != int(v.Revision)-1 {
			return httpapi.Response{}, changed()
		}
	} else {
		if in.ExpectedRevision != int(v.Revision) {
			return httpapi.Response{}, changed()
		}
		if err = q.ModerateAvatar(ctx, db.ModerateAvatarParams{AccountID: id, Status: status, ReviewedAt: pgtype.Timestamptz{Time: s.clock().UTC(), Valid: true}, ReviewedBy: pgtype.UUID{Bytes: actorID(r), Valid: true}}); err != nil {
			return httpapi.Response{}, err
		}
	}
	return s.getAdmin(ctx, r)
}
func (s *Service) list(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	query := r.HTTP.URL.Query()
	f := filters{strings.ToLower(strings.Join(strings.Fields(query.Get("q")), " ")), query.Get("status")}
	if strings.ContainsRune(f.Query, 0) {
		return httpapi.Response{}, invalidRequest()
	}
	if _, ok := query["status"]; ok && f.Status != "PENDING" && f.Status != "APPROVED" && f.Status != "HIDDEN" {
		return httpapi.Response{}, invalidRequest()
	}
	limit := 20
	if v, ok := query["limit"]; ok {
		n, e := strconv.Atoi(v[0])
		if e != nil || n < 1 || n > 100 {
			return httpapi.Response{}, invalidRequest()
		}
		limit = n
	}
	sc := scope("adminListAvatars", r.Actor.AccountID, f)
	var after pgtype.Timestamptz
	var id pgtype.UUID
	if v, ok := query["cursor"]; ok {
		c, e := s.decodeCursor(v[0], sc)
		if e != nil {
			return httpapi.Response{}, e
		}
		after = pgtype.Timestamptz{Time: c.Time, Valid: true}
		id = pgtype.UUID{Bytes: c.ID, Valid: true}
	}
	rows, err := db.New(r.Tx).ListAdminAvatars(ctx, db.ListAdminAvatarsParams{AvatarStatus: f.Status, SearchQuery: f.Query, CursorTime: after, CursorID: id, PageSize: int32(limit + 1)})
	if err != nil {
		return httpapi.Response{}, err
	}
	out := openapi.AdminAvatarPage{Items: make([]openapi.AdminAvatar, 0, min(limit, len(rows)))}
	if len(rows) > limit {
		last := rows[limit-1].AccountAvatar
		c := s.encodeCursor(sc, last.UploadedAt.Time, last.AccountID)
		out.NextCursor = &c
		rows = rows[:limit]
	}
	for _, v := range rows {
		out.Items = append(out.Items, s.adminDTO(db.ReadAdminAvatarRow(v)))
	}
	return httpapi.Response{Body: out}, nil
}
