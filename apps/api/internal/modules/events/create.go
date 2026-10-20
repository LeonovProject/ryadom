package events

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/activitytypes"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func fieldError(field string) error {
	e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Проверьте поля запроса.")
	e.Fields[field] = []string{"Некорректное значение."}
	return e
}
func (s *Service) create(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
	var input openapi.CreateEventInput
	if err := json.NewDecoder(r.HTTP.Body).Decode(&input); err != nil {
		return httpapi.Response{}, err
	}
	actor, err := uuid.Parse(r.Actor.AccountID)
	if err != nil {
		return httpapi.Response{}, err
	}
	for _, item := range []struct {
		name  string
		value *string
		max   int
		empty bool
	}{
		{"title", &input.Title, 160, false}, {"description", &input.Description, 10000, false}, {"city", &input.City, 120, false},
		{"locationText", &input.LocationText, 1000, false}, {"conditions", &input.Conditions, 4000, true}, {"timezone", &input.Timezone, 80, false},
	} {
		value := strings.TrimSpace(*item.value)
		if strings.ContainsRune(value, 0) || utf8.RuneCountInString(value) > item.max || (!item.empty && value == "") {
			return httpapi.Response{}, fieldError("/" + item.name)
		}
		*item.value = value
	}
	if input.Timezone == "Local" || strings.HasPrefix(input.Timezone, "/") || strings.Contains(input.Timezone, "..") {
		return httpapi.Response{}, fieldError("/timezone")
	}
	if _, err := time.LoadLocation(input.Timezone); err != nil {
		return httpapi.Response{}, fieldError("/timezone")
	}
	// Store microseconds explicitly, and compare the value that will actually be saved.
	start := input.StartsAt.UTC().Truncate(time.Microsecond)
	if start.Year() < 1 || start.Year() > 9999 {
		return httpapi.Response{}, fieldError("/startsAt")
	}
	if !start.After(s.clock()) {
		return httpapi.Response{}, fieldError("/startsAt")
	}
	kind, err := input.Organizer.Discriminator()
	if err != nil {
		return httpapi.Response{}, err
	}
	var personal, organization pgtype.UUID
	q := db.New(r.Tx)
	if kind == "PERSONAL" {
		personal = pgtype.UUID{Bytes: actor, Valid: true}
	} else {
		organizer, err := input.Organizer.AsOrganizationOrganizerInput()
		if err != nil {
			return httpapi.Response{}, err
		}
		org, err := q.LockPublishingOrganization(ctx, organizer.OrganizationId)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && org.OwnerAccountID != actor) {
			return httpapi.Response{}, fault.New(404, openapi.ErrorCodeNOTFOUND, "Организация не найдена.")
		}
		if err != nil {
			return httpapi.Response{}, err
		}
		state, err := q.LockPublishingApproval(ctx, org.ID)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && state != "APPROVED") {
			return httpapi.Response{}, fault.New(409, openapi.ErrorCodeORGNOTAPPROVED, "Организация ещё не допущена к публикации.")
		}
		if err != nil {
			return httpapi.Response{}, err
		}
		organization = pgtype.UUID{Bytes: org.ID, Valid: true}
	}
	activity, err := activitytypes.Resolve(ctx, r.Tx, input.ActivityType, actor)
	if err != nil {
		return httpapi.Response{}, err
	}
	// Locks above may have waited across the scheduled start. Recheck actual time.
	if !start.After(s.clock()) {
		return httpapi.Response{}, fieldError("/startsAt")
	}
	id, err := q.InsertEvent(ctx, db.InsertEventParams{CreatedByAccountID: actor, OrganizerAccountID: personal, OrganizationID: organization, ActivityTypeID: activity, Title: input.Title, Description: input.Description, StartsAt: start, Timezone: input.Timezone, City: input.City, LocationText: input.LocationText, Conditions: input.Conditions, JoinMode: string(input.JoinMode)})
	if err != nil {
		return httpapi.Response{}, err
	}
	r.PathParams = map[string]string{"eventId": id.String()}
	response, err := s.get(ctx, r)
	response.Status = 201
	return response, err
}
