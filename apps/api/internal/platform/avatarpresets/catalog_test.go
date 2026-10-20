package avatarpresets

import (
	"strings"
	"testing"
)

func TestManifest(t *testing.T) {
	valid := `{"items":[{"id":"one","label":"Аватар","imageUrl":"/assets/avatars/presets/one.svg"}]}`
	c, err := Read(strings.NewReader(valid))
	if err != nil {
		t.Fatal(err)
	}
	items := c.Items()
	items[0].Id = "mutated"
	if c.Items()[0].Id != "one" {
		t.Fatal("mutable catalogue")
	}
	if u, ok := c.URL("one"); !ok || u != "/assets/avatars/presets/one.svg" {
		t.Fatal("URL mismatch")
	}
	empty, err := Read(strings.NewReader(`{"items":[]}`))
	if err != nil || empty.Items() == nil || len(empty.Items()) != 0 {
		t.Fatal("empty manifest")
	}
	for _, input := range []string{`null`, `{}`, `{"items":null}`, `{"items":[],"items":[]}`, `{"items":[],"extra":true}`, `{"items":[]} {}`, strings.Repeat("x", 1048577), strings.Replace(valid, `"one"`, `"Bad"`, 1), strings.Replace(valid, `/assets/avatars/presets/one.svg`, `https://evil.test/one.svg`, 1), strings.Replace(valid, `"label":"Аватар"`, `"label":" "`, 1), strings.Replace(valid, `"id":"one"`, `"id":"one","id":"two"`, 1), strings.Replace(valid, `"label":"Аватар"`, `"label":"Аватар","unknown":"x"`, 1), strings.Replace(valid, `}]}`, `},{"id":"one","label":"Duplicate","imageUrl":"/assets/avatars/presets/one.svg"}]}`, 1)} {
		if _, err := Read(strings.NewReader(input)); err != ErrInvalidManifest {
			t.Fatal("bad manifest accepted")
		}
	}
	if _, err = Load("/nonexistent-private-path"); err != ErrInvalidManifest || strings.Contains(err.Error(), "private") {
		t.Fatal("manifest path leaked")
	}
}
