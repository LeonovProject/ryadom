package events

import (
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Every normalized filter belongs to the cursor scope; limit deliberately does not.
type filters struct {
	Query, City, JoinMode                              string
	ActivityTypeID, OrganizationID, OrganizerAccountID string
	From, To, DateFrom, DateTo                         string
}

func normalize(value string) string { return strings.ToLower(strings.Join(strings.Fields(value), " ")) }
func invalidRequest() error {
	return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректные фильтры.")
}
func invalidCursor() error {
	return fault.New(400, openapi.ErrorCodeINVALIDCURSOR, "Курсор не соответствует этому списку. Начните с первой страницы.")
}

func parseFilters(query url.Values) (filters, int, error) {
	f := filters{Query: normalize(query.Get("q")), City: normalize(query.Get("city")), JoinMode: query.Get("joinMode")}
	limit := 20
	if value, ok := query["limit"]; ok {
		var err error
		if len(value) != 1 {
			return f, 0, invalidRequest()
		}
		limit, err = strconv.Atoi(value[0])
		if err != nil || limit < 1 || limit > 100 {
			return f, 0, invalidRequest()
		}
	}
	for name, target := range map[string]*string{"activityTypeId": &f.ActivityTypeID, "organizationId": &f.OrganizationID, "organizerAccountId": &f.OrganizerAccountID} {
		if values, ok := query[name]; ok {
			if len(values) != 1 {
				return f, 0, invalidRequest()
			}
			id, err := uuid.Parse(values[0])
			if err != nil {
				return f, 0, invalidRequest()
			}
			*target = id.String()
		}
	}
	if f.OrganizationID != "" && f.OrganizerAccountID != "" {
		return f, 0, invalidRequest()
	}
	if _, ok := query["joinMode"]; ok && f.JoinMode != "OPEN" && f.JoinMode != "APPROVAL" {
		return f, 0, invalidRequest()
	}
	for name, target := range map[string]*string{"from": &f.From, "to": &f.To, "dateFrom": &f.DateFrom, "dateTo": &f.DateTo} {
		if values, ok := query[name]; ok {
			if len(values) != 1 {
				return f, 0, invalidRequest()
			}
			format := time.RFC3339Nano
			if strings.HasPrefix(name, "date") {
				format = time.DateOnly
			}
			value, err := time.Parse(format, values[0])
			if err != nil || value.Year() < 1 || value.Year() > 9999 {
				return f, 0, invalidRequest()
			}
			if format == time.DateOnly {
				*target = value.Format(format)
			} else {
				*target = value.UTC().Format(time.RFC3339Nano)
			}
		}
	}
	if f.From != "" && f.To != "" {
		from, _ := time.Parse(time.RFC3339Nano, f.From)
		to, _ := time.Parse(time.RFC3339Nano, f.To)
		if !to.After(from) {
			return f, 0, invalidRequest()
		}
	}
	if f.DateFrom != "" && f.DateTo != "" && f.DateTo <= f.DateFrom {
		return f, 0, invalidRequest()
	}
	return f, limit, nil
}

func nullableUUID(value string) pgtype.UUID {
	if value == "" {
		return pgtype.UUID{}
	}
	return pgtype.UUID{Bytes: uuid.MustParse(value), Valid: true}
}
func nullableTime(value string) pgtype.Timestamptz {
	if value == "" {
		return pgtype.Timestamptz{}
	}
	t, _ := time.Parse(time.RFC3339Nano, value)
	// PostgreSQL stores microseconds. Ceil both boundaries so >= from and < to
	// keep their meaning when an RFC3339 client supplies sub-microsecond digits.
	if remainder := t.Nanosecond() % 1000; remainder != 0 {
		t = t.Add(time.Duration(1000-remainder) * time.Nanosecond)
	}
	return pgtype.Timestamptz{Time: t, Valid: true}
}
func nullableDate(value string) pgtype.Date {
	if value == "" {
		return pgtype.Date{}
	}
	t, _ := time.Parse(time.DateOnly, value)
	return pgtype.Date{Time: t, Valid: true}
}
