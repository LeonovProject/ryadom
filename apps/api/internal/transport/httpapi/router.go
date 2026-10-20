package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/config"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	"github.com/LeonovProject/ryadom/apps/api/internal/platform/transaction"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Options struct {
	Origin       string
	CookieSecure bool
	Ready        func(context.Context) error
	Transactions *transaction.Runner
	Logger       *slog.Logger
}

type Request struct {
	HTTP       *http.Request
	Tx         pgx.Tx
	Actor      transaction.Principal
	PathParams map[string]string
}
type Response struct {
	Status  int
	Body    any
	RawBody []byte
	Header  http.Header
}
type Handler func(context.Context, Request) (Response, error)
type operation struct {
	method, path string
	item         *openapi3.PathItem
	spec         *openapi3.Operation
	access       transaction.Access
}
type Server struct {
	router     *chi.Mux
	spec       *openapi3.T
	operations map[string]operation
	bound      map[string]bool
	options    Options
}
type requestIDKey struct{}

func RequestID(ctx context.Context) string { id, _ := ctx.Value(requestIDKey{}).(string); return id }

func New(options Options) (*Server, error) {
	if !config.ValidOrigin(options.Origin) || options.Ready == nil {
		return nil, fmt.Errorf("HTTP origin and readiness probe are required")
	}
	if options.Logger == nil {
		options.Logger = slog.Default()
	}
	spec, err := openapi.GetSwagger()
	if err != nil {
		return nil, err
	}
	s := &Server{router: chi.NewRouter(), spec: spec, operations: map[string]operation{}, bound: map[string]bool{}, options: options}
	for path, item := range spec.Paths.Map() {
		for method, op := range item.Operations() {
			access, _ := op.Extensions["x-access"].(string)
			if !transaction.Access(access).Valid() {
				return nil, fmt.Errorf("missing access policy for %s", op.OperationID)
			}
			// oapi-codegen capitalizes operation IDs in its embedded specification.
			s.operations[strings.ToLower(op.OperationID)] = operation{method, path, item, op, transaction.Access(access)}
		}
	}
	s.router.NotFound(func(w http.ResponseWriter, r *http.Request) {
		s.writeError(w, r, fault.New(404, openapi.ErrorCodeNOTFOUND, "Маршрут не найден."))
	})
	s.router.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		s.writeError(w, r, fault.New(400, openapi.ErrorCodeINVALIDREQUEST, "Метод запроса не поддерживается."))
	})
	if err := s.bind("liveness", false, func(context.Context, Request) (Response, error) {
		return Response{Status: 200, Body: openapi.Health{Status: openapi.Ok}}, nil
	}); err != nil {
		return nil, err
	}
	if err := s.bind("readiness", false, func(ctx context.Context, _ Request) (Response, error) {
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		if err := options.Ready(ctx); err != nil {
			return Response{}, fault.New(503, openapi.ErrorCodeSERVICEUNAVAILABLE, "Сервис ещё не готов.")
		}
		return Response{Status: 200, Body: openapi.Health{Status: openapi.Ok}}, nil
	}); err != nil {
		return nil, err
	}
	return s, nil
}

// Register binds only an existing operation. Its path, permissions and validation
// come from the generated OpenAPI. Unregistered product routes stay unavailable.
func (s *Server) Register(operationID string, handler Handler) error {
	// The preset manifest is static build data and is independent of demo reset.
	return s.bind(operationID, !strings.EqualFold(operationID, "listAvatarPresets"), handler)
}

func (s *Server) bind(id string, transactional bool, handler Handler) error {
	id = strings.ToLower(id)
	op, exists := s.operations[id]
	if !exists || s.bound[id] || handler == nil {
		return fmt.Errorf("unknown or already registered operation %s", id)
	}
	if transactional && s.options.Transactions == nil {
		return fmt.Errorf("transaction runner required for %s", id)
	}
	s.bound[id] = true
	s.router.MethodFunc(op.method, "/api/v1"+op.path, func(w http.ResponseWriter, r *http.Request) {
		params := map[string]string{}
		for i, name := range chi.RouteContext(r.Context()).URLParams.Keys {
			params[name] = chi.RouteContext(r.Context()).URLParams.Values[i]
		}
		if err := s.validate(w, r, op, params); err != nil {
			s.writeError(w, r, err)
			return
		}
		var response Response
		call := func(tx pgx.Tx, actor transaction.Principal) error {
			if err := validateProtectedFields(r, op); err != nil {
				return err
			}
			var err error
			response, err = handler(r.Context(), Request{HTTP: r, Tx: tx, Actor: actor, PathParams: params})
			return err
		}
		var err error
		if transactional {
			var token *string
			if op.access != transaction.Public {
				if cookie, cookieErr := r.Cookie("ryadom_session"); cookieErr == nil {
					token = &cookie.Value
				}
			}
			err = s.options.Transactions.Run(r.Context(), transaction.Request{Access: op.access, Token: token, Resource: transaction.Resource{PathParams: params}, Exclusive: id == "adminresetdemodata"}, call)
		} else {
			err = call(nil, transaction.Principal{})
		}
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		// Encode before writing headers to avoid a successful partial JSON response.
		var data = response.RawBody
		if response.Body != nil && response.RawBody != nil {
			s.writeError(w, r, fmt.Errorf("ambiguous response body"))
			return
		}
		if response.Body != nil {
			data, err = json.Marshal(response.Body)
			if err != nil {
				s.writeError(w, r, err)
				return
			}
			data = append(data, '\n')
		}
		for name, values := range response.Header {
			if strings.EqualFold(name, "X-Request-ID") || strings.EqualFold(name, "Cache-Control") {
				continue
			}
			w.Header()[name] = values
		}
		if response.Status == 0 {
			response.Status = http.StatusOK
		}
		if response.Body != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
		}
		w.WriteHeader(response.Status)
		if data != nil {
			_, _ = w.Write(data)
		}
	})
	return nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	id := rand.Text()
	r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
	w.Header().Set("X-Request-ID", id)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	defer func() {
		if recover() != nil {
			s.options.Logger.Error("request panicked", "requestId", id)
			s.writeError(w, r, fmt.Errorf("request panicked"))
		}
	}()
	s.router.ServeHTTP(w, r)
}

func (s *Server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	e := fault.Public(err)
	if e.Status >= 500 {
		s.options.Logger.Error("request failed", "requestId", RequestID(r.Context()), "code", e.Code)
	}
	if e.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(e.RetryAfter))
	}
	if e.ClearSession {
		http.SetCookie(w, &http.Cookie{Name: "ryadom_session", Value: "", Path: "/api/v1", HttpOnly: true, Secure: s.options.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
	}
	fields := e.Fields
	if fields == nil {
		fields = map[string][]string{}
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(e.Status)
	_ = json.NewEncoder(w).Encode(openapi.ErrorResponse{Error: openapi.Error{Code: e.Code, Message: e.Message, RequestId: RequestID(r.Context()), FieldErrors: fields}})
}
