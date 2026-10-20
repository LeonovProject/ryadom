// Package accounts serves canonical public/private account DTOs in the caller's transaction.
package accounts

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Service struct{ catalog *avatarpresets.Catalog }

func New(catalog *avatarpresets.Catalog) *Service { return &Service{catalog: catalog} }
func (s *Service) Register(server *httpapi.Server) error {
	for _, binding := range []struct {
		id      string
		handler httpapi.Handler
	}{{"getMe", s.getMe}, {"getAccount", s.getAccount}, {"listAvatarPresets", s.listPresets}} {
		if err := server.Register(binding.id, binding.handler); err != nil {
			return err
		}
	}
	return nil
}
func (s *Service) Public(ctx context.Context, tx pgx.Tx, id uuid.UUID) (openapi.PublicAccount, error) {
	row, err := db.New(tx).ReadPublicAccount(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return openapi.PublicAccount{}, fault.New(404, openapi.ErrorCodeNOTFOUND, "Аккаунт не найден.")
	}
	if err != nil {
		return openapi.PublicAccount{}, err
	}
	var url *string
	if row.AvatarSource == "PRESET" && row.AvatarStatus == "APPROVED" && row.PresetID.Valid {
		if value, ok := s.catalog.URL(row.PresetID.String); ok {
			url = &value
		}
	}
	if row.AvatarSource == "CUSTOM" && row.AvatarStatus == "APPROVED" && row.AvatarRevision > 0 {
		value := fmt.Sprintf("/api/v1/accounts/%s/avatar?revision=%d", id, row.AvatarRevision)
		url = &value
	}
	return openapi.PublicAccount{Id: row.ID, DisplayName: row.DisplayName, IsBlocked: row.IsBlocked, AvatarUrl: url}, nil
}
func (s *Service) Me(ctx context.Context, tx pgx.Tx, id uuid.UUID, expires time.Time) (openapi.Me, error) {
	account, err := s.Public(ctx, tx, id)
	if err != nil {
		return openapi.Me{}, err
	}
	q := db.New(tx)
	private, err := q.ReadPrivateAccount(ctx, id)
	if err != nil {
		return openapi.Me{}, err
	}
	organizations, err := q.ListOwnedOrganizationRefs(ctx, id)
	if err != nil {
		return openapi.Me{}, err
	}
	refs := make([]openapi.OwnedOrganizationRef, 0, len(organizations))
	for _, o := range organizations {
		state := openapi.ApprovalState(o.ApprovalState)
		// The SQL projection uses DRAFT for an absent application; HTTP uses the contract enum.
		if o.ApprovalState == "DRAFT" {
			state = openapi.ApprovalStateNOTSUBMITTED
		}
		refs = append(refs, openapi.OwnedOrganizationRef{Id: o.ID, Name: o.Name, ApprovalState: state, CanPublish: o.CanPublish})
	}
	return openapi.Me{Account: account, Email: openapi.Email(private.Email), SystemRole: openapi.MeSystemRole(private.SystemRole), SessionExpiresAt: expires, Organizations: refs}, nil
}
func (s *Service) getMe(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id, err := uuid.Parse(r.Actor.AccountID)
	if err != nil {
		return httpapi.Response{}, err
	}
	body, err := s.Me(ctx, r.Tx, id, r.Actor.SessionExpiresAt)
	return httpapi.Response{Body: body}, err
}
func (s *Service) getAccount(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	id, err := uuid.Parse(r.PathParams["accountId"])
	if err != nil {
		return httpapi.Response{}, err
	}
	body, err := s.Public(ctx, r.Tx, id)
	return httpapi.Response{Body: body}, err
}
func (s *Service) listPresets(_ context.Context, _ httpapi.Request) (httpapi.Response, error) {
	return httpapi.Response{Body: openapi.AvatarPresetList{Items: s.catalog.Items()}}, nil
}
