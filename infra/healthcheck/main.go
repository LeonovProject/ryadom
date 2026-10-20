// healthcheck runs inside the shell-free API image; it prints no response data.
package main

import (
	"net/http"
	"os"
	"time"
)

func main() {
	url := "http://127.0.0.1:8080/api/v1/health/ready"
	if len(os.Args) == 2 {
		url = os.Args[1]
	} else if len(os.Args) != 1 {
		os.Exit(2)
	}
	client := http.Client{Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(url)
	if err != nil {
		os.Exit(1)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
