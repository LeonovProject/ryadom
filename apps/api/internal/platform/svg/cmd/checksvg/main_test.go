package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRun(t *testing.T) {
	dir := t.TempDir()
	valid := filepath.Join(dir, "valid.svg")
	invalid := filepath.Join(dir, "invalid.svg")
	large := filepath.Join(dir, "large.svg")
	for name, data := range map[string]string{valid: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="1"/></svg>`, invalid: `<svg><script/></svg>`, large: strings.Repeat("x", 131073)} {
		if err := os.WriteFile(name, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, test := range []struct {
		args []string
		code int
		ok   bool
	}{{nil, 2, false}, {[]string{valid}, 0, true}, {[]string{invalid}, 1, false}, {[]string{large}, 1, false}, {[]string{filepath.Join(dir, "missing")}, 1, false}, {[]string{invalid, valid}, 1, true}} {
		var out, errors bytes.Buffer
		if code := run(test.args, &out, &errors); code != test.code {
			t.Fatalf("exit %d, want %d", code, test.code)
		}
		if strings.Contains(out.String(), "OK ") != test.ok {
			t.Fatalf("wrong success output %s", out.String())
		}
		if test.code == 0 && errors.Len() != 0 {
			t.Fatal(errors.String())
		}
	}
	raw, err := os.ReadFile(valid)
	if err != nil || !strings.Contains(string(raw), "/>") {
		t.Fatal("checker modified asset")
	}
}
