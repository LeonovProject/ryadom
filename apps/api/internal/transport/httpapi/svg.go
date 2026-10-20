package httpapi

import "net/http"

// SVG returns a stored, normalized image without JSON encoding or inline markup.
// ServeHTTP supplies no-store and nosniff for both success and errors.
func SVG(document string) Response {
	return Response{RawBody: []byte(document), Header: http.Header{
		"Content-Type":            {"image/svg+xml"},
		"Content-Security-Policy": {"sandbox; default-src 'none'; style-src 'none'; script-src 'none'"},
	}}
}
