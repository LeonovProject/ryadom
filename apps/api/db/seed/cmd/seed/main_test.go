package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLIManifestSelection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "avatar-presets.json")
	for _, test := range []struct {
		name, body, want string
		valid            bool
	}{
		{"ready", `{"items":[{"id":"ryadom-companion","label":"Спутник","imageUrl":"/assets/avatars/presets/ryadom-companion.svg"}]}`, "ryadom-companion", true},
		{"empty", `{"items":[]}`, "", true},
		{"wrong image", `{"items":[{"id":"demo","imageUrl":"https://external.test/a.svg"}]}`, "", false},
		{"duplicate ID", `{"items":[{"id":"demo","imageUrl":"/assets/avatars/presets/demo.svg"},{"id":"demo","imageUrl":"/assets/avatars/presets/demo.svg"}]}`, "", false},
		{"malformed", `{`, "", false}, {"two objects", `{"items":[]} {}`, "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte(test.body), 0600); err != nil {
				t.Fatal(err)
			}
			got, err := readPreset(path)
			if (err == nil) != test.valid || got != test.want {
				t.Fatal(got, err)
			}
		})
	}
}

func TestCLIRejectsMissingConfiguration(t *testing.T) {
	var out bytes.Buffer
	if err := run(nil, func(string) string { return "" }, &out); err == nil {
		t.Fatal("missing DATABASE_URL accepted")
	}
	if err := run([]string{"extra"}, func(string) string { return "" }, &out); err == nil {
		t.Fatal("unexpected argument accepted")
	}
	if strings.Contains(out.String(), "password") {
		t.Fatal("configuration exposed a secret")
	}
}
