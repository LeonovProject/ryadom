package httpapi

import (
	"fmt"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"net/http"
	"strings"
)

// Disable hides a configured-off operation before authentication/transaction/body validation.
func (s *Server) Disable(id string) error {
	id = strings.ToLower(id)
	op, ok := s.operations[id]
	if !ok || s.bound[id] {
		return fmt.Errorf("unknown or already bound disabled operation %s", id)
	}
	s.bound[id] = true
	s.router.MethodFunc(op.method, "/api/v1"+op.path, func(w http.ResponseWriter, r *http.Request) {
		s.writeError(w, r, fault.New(404, openapi.ErrorCodeNOTFOUND, "Маршрут не найден."))
	})
	return nil
}
