package organizations

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/jackc/pgx/v5/pgtype"
	"io"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

type cursor struct {
	Version int       `json:"v"`
	Scope   string    `json:"s"`
	Time    time.Time `json:"t"`
	ID      uuid.UUID `json:"id"`
}

func scope(route, account string, f filters) string {
	data, _ := json.Marshal(struct {
		Route, Account string
		Filters        filters
	}{route, account, f})
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}
func (s *Service) encodeCursor(scope string, at time.Time, id uuid.UUID) string {
	data, _ := json.Marshal(cursor{1, scope, at.UTC(), id})
	mac := hmac.New(sha256.New, s.cursorKey)
	_, _ = mac.Write(data)
	return base64.RawURLEncoding.EncodeToString(data) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
func (s *Service) decodeCursor(raw, expectedScope string) (cursor, error) {
	var value cursor
	if len(raw) == 0 || len(raw) > 2048 {
		return value, invalidCursor()
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 2 {
		return value, invalidCursor()
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(parts[0])
	if err != nil {
		return value, invalidCursor()
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[1])
	if err != nil {
		return value, invalidCursor()
	}
	mac := hmac.New(sha256.New, s.cursorKey)
	_, _ = mac.Write(data)
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return value, invalidCursor()
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&value) != nil || decoder.Decode(new(any)) != io.EOF || value.Version != 1 || value.Scope != expectedScope || value.Time.IsZero() || value.Time.Year() < 1 || value.Time.Year() > 9999 || value.ID == uuid.Nil {
		return cursor{}, invalidCursor()
	}
	return value, nil
}

type filters struct{ Query, ApprovalState string }

func invalidCursor() error {
	return fault.New(400, openapi.ErrorCodeINVALIDCURSOR, "Курсор не соответствует этому списку. Начните с первой страницы.")
}
func (s *Service) pageCursor(q url.Values, scope string) (pgtype.Timestamptz, pgtype.UUID, error) {
	values, present := q["cursor"]
	if !present {
		return pgtype.Timestamptz{}, pgtype.UUID{}, nil
	}
	if len(values) != 1 {
		return pgtype.Timestamptz{}, pgtype.UUID{}, invalidCursor()
	}
	c, err := s.decodeCursor(values[0], scope)
	return pgtype.Timestamptz{Time: c.Time, Valid: err == nil}, pgtype.UUID{Bytes: c.ID, Valid: err == nil}, err
}
