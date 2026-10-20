// Package fault defines safe application errors, separate from internal diagnostics.
package fault

import (
	"errors"
	"net/http"

	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
)

type Error struct {
	Status       int
	Code         openapi.ErrorCode
	Message      string
	Fields       map[string][]string
	ClearSession bool
	RetryAfter   int
}

func (e *Error) Error() string { return string(e.Code) }

func New(status int, code openapi.ErrorCode, message string) *Error {
	return &Error{Status: status, Code: code, Message: message, Fields: map[string][]string{}}
}

func Public(err error) *Error {
	var safe *Error
	if errors.As(err, &safe) {
		return safe
	}
	return New(http.StatusInternalServerError, openapi.ErrorCodeINTERNALERROR, "Внутренняя ошибка сервера.")
}
