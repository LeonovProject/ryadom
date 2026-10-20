// Package organizations binds ADMIN organization operations to their sole domain owner.
package organizations

import (
	domain "github.com/LeonovProject/ryadom/apps/api/internal/modules/organizations"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
)

func Register(server *httpapi.Server, service *domain.Service) error {
	for _, binding := range []struct {
		id      string
		handler httpapi.Handler
	}{
		{"adminListOrganizations", service.AdminList}, {"adminGetOrganization", service.AdminGet}, {"adminDecideOrganization", service.Decide},
	} {
		if err := server.Register(binding.id, binding.handler); err != nil {
			return err
		}
	}
	return nil
}
