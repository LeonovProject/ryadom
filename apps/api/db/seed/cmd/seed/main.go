// Command seed explicitly initializes a migrated, empty demonstration database.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/db/seed"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/database"
)

func main() {
	if err := run(os.Args[1:], os.Getenv, os.Stdout); err != nil {
		if errors.Is(err, seed.ErrDatabaseNotEmpty) {
			fmt.Fprintln(os.Stderr, "База содержит данные без полного набора демоаккаунтов. Изменений нет.")
		} else {
			fmt.Fprintln(os.Stderr, "Демонабор не загружен. Проверьте конфигурацию, миграции и путь к каталогу аватаров.")
		}
		os.Exit(1)
	}
}

func run(args []string, getenv func(string) string, output io.Writer) error {
	flags := flag.NewFlagSet("seed", flag.ContinueOnError)
	flags.SetOutput(output)
	manifest := flags.String("presets", "../../packages/contracts/avatar-presets.json", "path to this build's shared avatar-presets.json")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	if getenv("DATABASE_URL") == "" {
		return errors.New("DATABASE_URL required")
	}
	preset, err := readPreset(*manifest)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	pool, err := database.Open(ctx, getenv("DATABASE_URL"))
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.Ready(ctx, pool, 2026102001); err != nil {
		return err
	}
	result, err := seed.Initialize(ctx, pool, seed.Options{PresetID: preset})
	if err != nil {
		return err
	}
	if !result.Applied {
		_, err = fmt.Fprintln(output, "Демомаркеры уже существуют. Данные и решения сохранены.")
		return err
	}
	_, err = fmt.Fprintf(output, "Демонабор %s загружен; базовая дата %s (Asia/Krasnoyarsk). Сессии не создавались.\n", result.Version, result.BaseDate)
	return err
}

// This is only CLI input selection, not an independent runtime API catalogue.
// BE-02 owns the shared runtime catalogue reader; SVG validation stays MEDIA-00.
func readPreset(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	var manifest struct {
		Items []struct{ ID, Label, ImageURL string }
	}
	decoder := json.NewDecoder(io.LimitReader(file, 1048577))
	if err := decoder.Decode(&manifest); err != nil {
		return "", err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return "", errors.New("invalid preset manifest")
	}
	seen := map[string]bool{}
	for _, item := range manifest.Items {
		if item.ID == "" || seen[item.ID] || item.ImageURL != "/assets/avatars/presets/"+item.ID+".svg" {
			return "", errors.New("invalid preset manifest")
		}
		seen[item.ID] = true
	}
	if len(manifest.Items) == 0 {
		return "", nil
	}
	return manifest.Items[0].ID, nil
}
