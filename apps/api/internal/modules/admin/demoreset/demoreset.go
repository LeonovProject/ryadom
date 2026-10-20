// Package demoreset resets only the subject tables, inside the caller's exclusive barrier transaction.
package demoreset

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/LeonovProject/ryadom/apps/api/db/seed"
	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"net/http"
	"time"
)

type Service struct {
	enabled, secure bool
	preset          string
	clock           func() time.Time
}

func New(enabled, secure bool, preset string, clock func() time.Time) (*Service, error) {
	if clock == nil {
		return nil, fmt.Errorf("demo reset requires clock")
	}
	return &Service{enabled, secure, preset, clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"adminGetDemoState", s.state}, {"adminResetDemoData", s.reset}} {
		if !s.enabled {
			if err := server.Disable(b.id); err != nil {
				return err
			}
		} else if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func receipt(d db.DemoState) *openapi.NullableDemoResetReceipt {
	if !d.LastResetID.Valid {
		return nil
	}
	v := &openapi.NullableDemoResetReceipt{ResetId: uuid.UUID(d.LastResetID.Bytes), PreviousGeneration: uuid.UUID(d.LastResetFromGeneration.Bytes), Generation: d.Generation, CompletedAt: d.LastResetAt.Time.UTC(), SeedVersion: d.LastResetSeedVersion.String}
	v.SeedBaseDate.Time = d.LastResetBaseDate.Time
	return v
}
func (s *Service) state(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	d, err := db.New(r.Tx).ReadDemoState(ctx)
	if err != nil {
		return httpapi.Response{}, err
	}
	zone, err := time.LoadLocation("Asia/Krasnoyarsk")
	if err != nil {
		return httpapi.Response{}, err
	}
	now := s.clock().In(zone)
	v := openapi.DemoState{Generation: d.Generation, SeedVersion: seed.Version, LastReset: receipt(d)}
	v.PlannedBaseDate.Time = time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	return httpapi.Response{Body: v}, nil
}
func (s *Service) reset(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	// Runner already holds demo_state FOR UPDATE and has rechecked ADMIN after the wait.
	var in openapi.DemoResetInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	if in.Confirmation != "СБРОСИТЬ" {
		return httpapi.Response{}, fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Введите СБРОСИТЬ.")
	}
	q := db.New(r.Tx)
	before, err := q.ReadDemoState(ctx)
	if err != nil {
		return httpapi.Response{}, err
	}
	if in.ExpectedGeneration != before.Generation || in.ExpectedSeedVersion != seed.Version || (before.LastResetID.Valid && uuid.UUID(before.LastResetID.Bytes) == in.ResetId) {
		return httpapi.Response{}, fault.New(409, openapi.ErrorCodeDEMOSTATECHANGED, "Демобаза изменилась. Обновите сведения и подтвердите новое действие.")
	}
	for _, remove := range []func(context.Context) error{q.DeleteResetReports, q.DeleteResetMessages, q.DeleteResetParticipations, q.DeleteResetEvents, q.DeleteResetOrganizationApplications, q.DeleteResetOrganizations, q.DeleteResetSessions, q.DeleteResetAccountAvatars, q.DeleteResetActivityTypes, q.DeleteResetAccounts} {
		if err = remove(ctx); err != nil {
			return httpapi.Response{}, err
		}
	}
	applied, err := seed.Apply(ctx, r.Tx, seed.Options{PresetID: s.preset, Clock: s.clock})
	if err != nil {
		return httpapi.Response{}, err
	}
	if !applied.Applied {
		return httpapi.Response{}, fmt.Errorf("demo reset did not seed an empty dataset")
	}
	generation, err := uuid.NewRandom()
	if err != nil {
		return httpapi.Response{}, err
	}
	day, err := time.Parse(time.DateOnly, applied.BaseDate)
	if err != nil {
		return httpapi.Response{}, err
	}
	at := s.clock().UTC()
	if err = q.RecordDemoReset(ctx, db.RecordDemoResetParams{Generation: generation, ResetID: in.ResetId, PreviousGeneration: before.Generation, CompletedAt: at, SeedVersion: seed.Version, BaseDate: pgtype.Date{Time: day, Valid: true}}); err != nil {
		return httpapi.Response{}, err
	}
	// Read back PostgreSQL's stored precision, so a recovered receipt is identical.
	saved, err := q.ReadDemoState(ctx)
	if err != nil {
		return httpapi.Response{}, err
	}
	v := openapi.DemoResetReceipt(*receipt(saved))
	cookie := http.Cookie{Name: "ryadom_session", Value: "", Path: "/api/v1", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)}
	return httpapi.Response{Body: v, Header: http.Header{"Set-Cookie": []string{cookie.String()}}}, nil
}
