// Package messages binds ADMIN routes to the sole discussion domain owner.
package messages

import (
	"github.com/LeonovProject/ryadom/apps/api/internal/modules/discussion"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
)

func Register(server *httpapi.Server, service *discussion.Service) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"adminListMessages", service.AdminList}, {"adminHideMessage", service.Hide}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
