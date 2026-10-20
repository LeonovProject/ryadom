// Package auth implements email/password login and the shared SQL session guard.
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type Service struct {
	tokens   *authn.Tokens
	limiter  *authn.AttemptLimiter
	ips      *authn.ClientIPs
	catalog  *avatarpresets.Catalog
	accounts *accounts.Service
	secure   bool
	clock    authn.Clock
}
type Options struct {
	Tokens       *authn.Tokens
	Attempts     *authn.AttemptLimiter
	IPs          *authn.ClientIPs
	Catalog      *avatarpresets.Catalog
	Accounts     *accounts.Service
	CookieSecure bool
	Clock        authn.Clock
}

func New(o Options) (*Service, error) {
	if o.Tokens == nil || o.Attempts == nil || o.IPs == nil || o.Catalog == nil || o.Accounts == nil {
		return nil, errors.New("auth dependencies required")
	}
	if o.Clock == nil {
		o.Clock = time.Now
	}
	return &Service{tokens: o.Tokens, limiter: o.Attempts, ips: o.IPs, catalog: o.Catalog, accounts: o.Accounts, secure: o.CookieSecure, clock: o.Clock}, nil
}
func (s *Service) Register(server *httpapi.Server) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"login", s.login}, {"register", s.register}, {"logout", s.logout}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
func field(name, message string) error {
	e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Проверьте поля запроса.")
	e.Fields["/"+name] = []string{message}
	return e
}
func invalidCredentials() error {
	return fault.New(401, openapi.ErrorCodeINVALIDCREDENTIALS, "Неверный email или пароль.")
}
func (s *Service) attempt(r *http.Request, email string, registration bool) error {
	ip, err := s.ips.Resolve(r)
	if err != nil {
		return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректный адрес клиента.")
	}
	var decision authn.AttemptDecision
	if registration {
		decision, err = s.limiter.CheckRegister(ip)
	} else {
		decision, err = s.limiter.CheckLogin(ip, email)
	}
	if err != nil {
		return field("email", "Укажите корректный email без пробелов.")
	}
	if !decision.Allowed {
		e := fault.New(429, openapi.ErrorCodeRATELIMITED, "Слишком много попыток. Попробуйте позже.")
		e.RetryAfter = decision.RetryAfter
		return e
	}
	return nil
}
func (s *Service) login(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.LoginInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	email, err := authn.CanonicalEmail(string(in.Email))
	if err != nil {
		return httpapi.Response{}, field("email", "Укажите корректный email без пробелов.")
	}
	if err = s.attempt(r.HTTP, email, false); err != nil {
		return httpapi.Response{}, err
	}
	actor, err := db.New(r.Tx).AccountForLogin(ctx, email)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return httpapi.Response{}, err
	}
	match, err := authn.VerifyLoginPassword(in.Password, actor.PasswordHash)
	if err != nil {
		return httpapi.Response{}, err
	}
	if !match {
		return httpapi.Response{}, invalidCredentials()
	}
	if actor.Status == "BLOCKED" {
		return httpapi.Response{}, blocked(false)
	}
	if actor.Status != "ACTIVE" {
		return httpapi.Response{}, invalidCredentials()
	}
	return s.newSession(ctx, r, actor.ID, 200)
}
func (s *Service) register(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var in openapi.RegisterInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&in); err != nil {
		return httpapi.Response{}, err
	}
	if err := s.attempt(r.HTTP, "", true); err != nil {
		return httpapi.Response{}, err
	}
	email, err := authn.CanonicalEmail(string(in.Email))
	if err != nil {
		return httpapi.Response{}, field("email", "Укажите корректный email без пробелов.")
	}
	name := strings.TrimSpace(in.DisplayName)
	if utf8.RuneCountInString(name) < 1 || utf8.RuneCountInString(name) > 120 {
		return httpapi.Response{}, field("displayName", "Имя должно содержать от 1 до 120 символов.")
	}
	if _, ok := s.catalog.URL(in.PresetId); !ok {
		return httpapi.Response{}, field("presetId", "Выберите доступный готовый аватар.")
	}
	hash, err := authn.HashPassword(in.Password)
	if err != nil {
		return httpapi.Response{}, err
	}
	id, err := db.New(r.Tx).CreateAccount(ctx, db.CreateAccountParams{DisplayName: name, Email: email, PasswordHash: hash})
	if err != nil {
		var constraint *pgconn.PgError
		if errors.As(err, &constraint) && constraint.Code == "23505" && constraint.ConstraintName == "accounts_email_key" {
			e := fault.New(409, openapi.ErrorCodeEMAILTAKEN, "Этот email уже занят.")
			e.Fields["/email"] = []string{"Войдите или укажите другой адрес."}
			return httpapi.Response{}, e
		}
		return httpapi.Response{}, err
	}
	if err = db.New(r.Tx).CreateInitialPresetAvatar(ctx, db.CreateInitialPresetAvatarParams{AccountID: id, PresetID: pgtype.Text{String: in.PresetId, Valid: true}}); err != nil {
		return httpapi.Response{}, err
	}
	return s.newSession(ctx, r, id, 201)
}
func (s *Service) newSession(ctx context.Context, r httpapi.Request, id uuid.UUID, status int) (httpapi.Response, error) {
	// Revoke only the old cookie's session, and only in the successful transaction.
	if c, err := r.HTTP.Cookie("ryadom_session"); err == nil {
		if err = s.revokePresented(ctx, r.Tx, c.Value); err != nil {
			return httpapi.Response{}, err
		}
	}
	sessionID, err := uuid.NewRandom()
	if err != nil {
		return httpapi.Response{}, err
	}
	token, err := s.tokens.Issue(id, sessionID)
	if err != nil {
		return httpapi.Response{}, err
	}
	claims := token.Claims()
	if err = db.New(r.Tx).CreateSession(ctx, db.CreateSessionParams{ID: sessionID, AccountID: id, TokenHash: token.Digest(), CreatedAt: claims.IssuedAt, ExpiresAt: claims.ExpiresAt}); err != nil {
		return httpapi.Response{}, err
	}
	me, err := s.accounts.Me(ctx, r.Tx, id, claims.ExpiresAt)
	if err != nil {
		return httpapi.Response{}, err
	}
	cookie := &http.Cookie{Name: "ryadom_session", Value: token.Value(), Path: "/api/v1", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: int(authn.SessionLifetime / time.Second), Expires: claims.ExpiresAt}
	return httpapi.Response{Status: status, Body: me, Header: http.Header{"Set-Cookie": []string{cookie.String()}}}, nil
}
func (s *Service) logout(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	if c, err := r.HTTP.Cookie("ryadom_session"); err == nil {
		if err = s.revokePresented(ctx, r.Tx, c.Value); err != nil {
			return httpapi.Response{}, err
		}
	}
	cookie := &http.Cookie{Name: "ryadom_session", Value: "", Path: "/api/v1", HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)}
	return httpapi.Response{Status: 204, Header: http.Header{"Set-Cookie": []string{cookie.String()}}}, nil
}
