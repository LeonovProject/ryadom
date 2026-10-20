// Package activitytypes reads the public, approved catalog in the caller's transaction.
package activitytypes

import (
	"context"

	"github.com/LeonovProject/ryadom/apps/api/internal/db"
	"github.com/LeonovProject/ryadom/apps/api/internal/transport/httpapi"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
)

func Register(server *httpapi.Server) error {
	return server.Register("listActivityTypes", func(ctx context.Context, r httpapi.Request) (httpapi.Response, error) {
		rows, err := db.New(r.Tx).ListApprovedActivityTypes(ctx)
		if err != nil {
			return httpapi.Response{}, err
		}
		items := make([]openapi.ActivityType, 0, len(rows))
		for _, row := range rows {
			items = append(items, openapi.ActivityType{Id: row.ID, Name: row.Name})
		}
		return httpapi.Response{Body: openapi.ActivityTypes{Items: items}}, nil
	})
}
