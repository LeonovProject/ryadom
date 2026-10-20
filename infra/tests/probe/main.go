// Isolated proxy fixture, never registered in the product API.
package main

import (
	"encoding/json"
	"net/http"
	"os"
	"time"
)

func main() {
	http.HandleFunc("/api/v1/health/ready", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })
	http.HandleFunc("/api/v1/_infra/probe", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		if r.URL.Query().Get("cookie") == "set" {
			http.SetCookie(w, &http.Cookie{Name: "ryadom_session", Value: "proxy-transport-fixture", Path: "/api/v1", HttpOnly: true, Secure: os.Getenv("COOKIE_SECURE") == "true", SameSite: http.SameSiteLaxMode, MaxAge: 86400})
		}
		data := map[string]string{}
		for _, h := range []string{"X-Real-IP", "X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host", "Forwarded", "Cookie"} {
			data[h] = r.Header.Get(h)
		}
		data["host"] = r.Host
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(data)
	})
	server := http.Server{Addr: ":8080", ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second}
	if server.ListenAndServe() != nil {
		os.Exit(1)
	}
}
