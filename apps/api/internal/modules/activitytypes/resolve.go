package activitytypes

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/text/unicode/norm"
)

// Resolve uses the caller's transaction; a new direction is never committed alone.
// Existing decisions, names, reviewers and dates are preserved, including REJECTED.
func Resolve(ctx context.Context, tx pgx.Tx, input openapi.ActivityInput, actor uuid.UUID) (uuid.UUID, error) {
	q := db.New(tx)
	// ActivityInput is an undiscriminated union: its public JSON variants are id/name.
	data, err := input.MarshalJSON()
	if err != nil {
		return uuid.Nil, err
	}
	var value struct {
		ID   *uuid.UUID `json:"id"`
		Name *string    `json:"name"`
	}
	if err = json.Unmarshal(data, &value); err != nil {
		return uuid.Nil, err
	}
	if value.ID != nil {
		id, err := q.LockActivityForCreation(ctx, *value.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, fault.New(404, openapi.ErrorCodeNOTFOUND, "Направление не найдено.")
		}
		return id, err
	}
	if value.Name == nil {
		return uuid.Nil, validation("/activityType/name")
	}
	name := strings.Join(strings.Fields(norm.NFC.String(*value.Name)), " ")
	if utf8.RuneCountInString(*value.Name) > 100 || name == "" || utf8.RuneCountInString(name) > 100 || strings.ContainsRune(name, 0) {
		return uuid.Nil, validation("/activityType/name")
	}
	normalized := strings.ToLower(name)
	for attempt := 0; attempt < 3; attempt++ {
		if err = q.InsertPendingActivity(ctx, db.InsertPendingActivityParams{Name: name, NormalizedName: normalized, CreatedByAccountID: pgtype.UUID{Bytes: actor, Valid: true}}); err != nil {
			return uuid.Nil, err
		}
		id, err := q.FindActivityForCreation(ctx, normalized)
		if err == nil {
			return id, nil
		}
		// A concurrent administrative rename can release the old name before the
		// subsequent READ COMMITTED statement; resolve that name again under UNIQUE.
		if !errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, err
		}
	}
	return uuid.Nil, errors.New("activity name changed repeatedly")
}
func validation(field string) error {
	e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Проверьте поля запроса.")
	e.Fields[field] = []string{"Некорректное значение."}
	return e
}
