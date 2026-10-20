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
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/auth"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/events"
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
