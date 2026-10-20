package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
)

func invalidRequest() *fault.Error {
	return fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Некорректный запрос.")
}

func (s *Server) validate(w http.ResponseWriter, r *http.Request, op operation, params map[string]string) error {
	if op.method != http.MethodGet && op.method != http.MethodHead && op.method != http.MethodOptions {
		origins := r.Header.Values("Origin")
		if len(origins) != 1 || origins[0] != s.options.Origin {
			return fault.New(403, openapi.ErrorCodeCSRFREJECTED, "Источник запроса не разрешён.")
		}
	}
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return invalidRequest()
	}
	allowed := map[string]bool{}
	parameters := append(append(openapi3.Parameters{}, op.item.Parameters...), op.spec.Parameters...)
	for _, ref := range parameters {
		if ref.Value.In == "query" {
			allowed[ref.Value.Name] = true
		}
	}
	for name, values := range query {
		if !allowed[name] || len(values) != 1 {
			return invalidRequest()
		}
	}
	input := &openapi3filter.RequestValidationInput{Request: r, PathParams: params, QueryParams: query, Route: &routers.Route{Spec: s.spec, Path: op.path, PathItem: op.item, Method: op.method, Operation: op.spec}, Options: &openapi3filter.Options{ExcludeRequestBody: true, SkipSettingDefaults: true, AuthenticationFunc: openapi3filter.NoopAuthenticationFunc}}
	if err := openapi3filter.ValidateRequest(r.Context(), input); err != nil {
		return invalidRequest()
	}
	limit := int64(65536)
	if raw, ok := op.spec.Extensions["x-max-body-bytes"].(float64); ok {
		limit = int64(raw)
	}
	if op.spec.RequestBody == nil {
		limit = 0
	}
	if r.ContentLength > limit {
		if limit == 0 {
			return invalidRequest()
		}
		return fault.New(413, openapi.ErrorCodePAYLOADTOOLARGE, "Тело запроса слишком большое.")
	}
	if r.Body == nil {
		r.Body = http.NoBody
	}
	originalBody := r.Body
	defer originalBody.Close()
	body, err := io.ReadAll(http.MaxBytesReader(w, originalBody, limit))
	if err != nil {
		if limit == 0 {
			return invalidRequest()
		}
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return fault.New(413, openapi.ErrorCodePAYLOADTOOLARGE, "Тело запроса слишком большое.")
		}
		return invalidRequest()
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	if op.spec.RequestBody == nil {
		return nil
	}
	media, attributes, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaErr != nil || media != "application/json" || (attributes["charset"] != "" && !strings.EqualFold(attributes["charset"], "utf-8")) || r.Header.Get("Content-Encoding") != "" {
		return fault.New(415, openapi.ErrorCodeUNSUPPORTEDMEDIATYPE, "Используйте JSON в UTF-8 без сжатия.")
	}
	var value any
	if !utf8.Valid(body) || json.Unmarshal(body, &value) != nil {
		return invalidRequest()
	}
	// Protected requests check field semantics after the current session/rights.
	if op.access != "public" {
		return nil
	}
	return validateFields(op, value)
}

func validateFields(op operation, value any) error {
	schema := op.spec.RequestBody.Value.Content["application/json"].Schema.Value
	if err := schema.VisitJSON(value, openapi3.MultiErrors(), openapi3.VisitAsRequest()); err != nil {
		e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "Проверьте поля запроса.")
		collectFields(err, e.Fields)
		return e
	}
	return nil
}

func validateProtectedFields(r *http.Request, op operation) error {
	if op.spec.RequestBody == nil || op.access == "public" {
		return nil
	}
	// Transport already checked syntax and bounded this in-memory body.
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return invalidRequest()
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		return invalidRequest()
	}
	return validateFields(op, value)
}

// Never include SchemaError.Error(): it may contain the submitted password/SVG.
func collectFields(err error, fields map[string][]string) {
	if many, ok := err.(openapi3.MultiError); ok {
		for _, item := range many {
			collectFields(item, fields)
		}
		return
	}
	var schema *openapi3.SchemaError
	if !errors.As(err, &schema) {
		fields[""] = []string{"Некорректное значение."}
		return
	}
	pointer := ""
	for _, segment := range schema.JSONPointer() {
		pointer += "/" + escapePointer(segment)
	}
	if object, ok := schema.Value.(map[string]any); ok {
		if schema.SchemaField == "required" {
			fields[pointer] = []string{"Обязательное поле."}
			return
		}
		if schema.SchemaField == "properties" && schema.Schema.AdditionalProperties.Has != nil && !*schema.Schema.AdditionalProperties.Has {
			for name := range object {
				if _, exists := schema.Schema.Properties[name]; !exists {
					fields[pointer+"/"+escapePointer(name)] = []string{"Неизвестное поле."}
				}
			}
			return
		}
	}
	fields[pointer] = []string{"Некорректное значение."}
}

func escapePointer(segment string) string {
	return strings.ReplaceAll(strings.ReplaceAll(segment, "~", "~0"), "/", "~1")
}
