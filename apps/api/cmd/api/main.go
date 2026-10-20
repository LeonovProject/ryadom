package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts/avatar"
	accountmoderation "github.com/LeonovProject/ryadom/apps/api/internal/modules/accounts/moderation"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes"
	activityreview "github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes/review"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/admin/demoreset"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/auth"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/discussion"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/events"
	eventmoderation "github.com/LeonovProject/ryadom/apps/api/internal/modules/moderation/events"
	messagemoderation "github.com/LeonovProject/ryadom/apps/api/internal/modules/moderation/messages"
	orgmoderation "github.com/LeonovProject/ryadom/apps/api/internal/modules/moderation/organizations"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/organizations"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/participation"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/reports"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/avatarpresets"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/config"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/database"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/transaction"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("API stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	catalog, err := avatarpresets.Load(cfg.AvatarPresetsFile)
	if err != nil {
		return err
	}
	tokens, err := authn.NewTokens(cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	ips, err := authn.NewClientIPs(cfg.TrustedProxyCIDRs)
	if err != nil {
		return err
	}
	accountService := accounts.New(catalog)
	authService, err := auth.New(auth.Options{Tokens: tokens, Attempts: authn.NewAttemptLimiter(time.Now), IPs: ips, Catalog: catalog, Accounts: accountService, CookieSecure: cfg.CookieSecure, Clock: time.Now})
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	handler, err := httpapi.New(httpapi.Options{Origin: cfg.WebOrigin, CookieSecure: cfg.CookieSecure, Logger: logger, Transactions: &transaction.Runner{DB: pool, Guard: authService}, Ready: func(ctx context.Context) error { return database.Ready(ctx, pool, cfg.SchemaVersion) }})
	if err != nil {
		return err
	}
	if err := accountService.Register(handler); err != nil {
		return err
	}
	if err := authService.Register(handler); err != nil {
		return err
	}
	eventService, err := events.New(accountService, cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	if err := eventService.Register(handler); err != nil {
		return err
	}
	if err := activitytypes.Register(handler); err != nil {
		return err
	}
	orgService, err := organizations.New(accountService, cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	if err = orgService.Register(handler); err != nil {
		return err
	}
	if err = orgmoderation.Register(handler, orgService); err != nil {
		return err
	}
	participationService, err := participation.New(accountService, eventService, cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	if err = participationService.Register(handler); err != nil {
		return err
	}
	discussionService, err := discussion.New(accountService, cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	if err = discussionService.Register(handler); err != nil {
		return err
	}
	if err = messagemoderation.Register(handler, discussionService); err != nil {
		return err
	}
	if err = eventmoderation.Register(handler, eventService); err != nil {
		return err
	}
	activityReview, err := activityreview.New(accountService, cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	if err = activityReview.Register(handler); err != nil {
		return err
	}
	reportService, err := reports.New(eventService, discussionService, time.Now)
	if err != nil {
		return err
	}
	if err = reportService.Register(handler); err != nil {
		return err
	}
	preset := ""
	if items := catalog.Items(); len(items) > 0 {
		preset = items[0].Id
	}
	demoReset, err := demoreset.New(cfg.DemoMode, cfg.CookieSecure, preset, time.Now)
	if err != nil {
		return err
	}
	if err = demoReset.Register(handler); err != nil {
		return err
	}
	accountModeration, err := accountmoderation.New(accountService, cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	if err = accountModeration.Register(handler); err != nil {
		return err
	}
	avatars, err := avatar.New(accountService, catalog, cfg.JWTSecret, time.Now)
	if err != nil {
		return err
	}
	if err = avatars.Register(handler); err != nil {
		return err
	}
	server := &http.Server{Addr: cfg.Address, Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384}
	stopped := make(chan error, 1)
	go func() { stopped <- server.ListenAndServe() }()
	select {
	case err := <-stopped:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdownCtx); err != nil {
			_ = server.Close()
			return err
		}
		return nil
	}
}
