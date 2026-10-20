package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Run in the isolated Compose check, where listening on loopback is available.
func TestProcessLifecycle(t *testing.T) {
	if os.Getenv("RYADOM_API_TEST_CHILD") == "1" {
		main()
		return
	}
	if os.Getenv("RYADOM_API_TEST_DATABASE_URL") == "" {
		t.Skip("run process smoke test in the isolated Compose check")
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(os.Args[0], "-test.run=^TestProcessLifecycle$")
	settings := map[string]string{
		"RYADOM_API_TEST_CHILD": "1", "API_ADDR": address,
		"DATABASE_URL":            "postgres://unused:unused@127.0.0.1:1/unavailable?sslmode=disable",
		"AVATAR_PRESETS_FILE":     "../../../../packages/contracts/avatar-presets.json",
		"DATABASE_SCHEMA_VERSION": "1", "WEB_ORIGIN": "http://localhost:8080", "COOKIE_SECURE": "false",
		"AUTH_JWT_SECRET": base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{1}, 32)),
	}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if _, override := settings[key]; !override {
			cmd.Env = append(cmd.Env, entry)
		}
	}
	for key, value := range settings {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	var logs bytes.Buffer
	cmd.Stdout = &logs
	cmd.Stderr = &logs
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer cmd.Process.Kill()
	client := &http.Client{Timeout: time.Second}
	deadline := time.Now().Add(10 * time.Second)
	for {
		response, err := client.Get("http://" + address + "/api/v1/health/live")
		if err == nil {
			var health map[string]string
			decodeErr := json.NewDecoder(response.Body).Decode(&health)
			response.Body.Close()
			if response.StatusCode != 200 || decodeErr != nil || health["status"] != "ok" {
				t.Fatal("invalid live response", response.StatusCode, decodeErr)
			}
			break
		}
		if time.Now().After(deadline) {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			t.Fatal("API failed to start", logs.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
	response, err := client.Get("http://" + address + "/api/v1/health/ready")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 503 {
		t.Fatal("unavailable DB did not fail readiness", response.StatusCode)
	}
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- cmd.Wait() }()
	select {
	case err := <-finished:
		if err != nil {
			t.Fatal("shutdown failed", err, logs.String())
		}
	case <-time.After(12 * time.Second):
		t.Fatal("shutdown did not finish")
	}
}
