// Package events binds administrative routes to the sole event domain owner.
package events

import (
	domain "github.com/LeonovProject/ryadom/apps/api/internal/modules/events"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
)

func Register(server *httpapi.Server, service *domain.Service) error {
	for _, b := range []struct {
		id      string
		handler httpapi.Handler
	}{{"adminListEvents", service.AdminList}, {"adminGetEvent", service.AdminGet}, {"adminUnpublishEvent", service.Unpublish}} {
		if err := server.Register(b.id, b.handler); err != nil {
			return err
		}
	}
	return nil
}
