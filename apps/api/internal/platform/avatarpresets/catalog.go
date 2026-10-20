// Package avatarpresets owns the single immutable runtime manifest reader.
package avatarpresets

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
)

var ErrInvalidManifest = errors.New("invalid avatar preset manifest")
var presetID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

type Catalog struct {
	items []openapi.AvatarPreset
	urls  map[string]string
}

func Load(path string) (*Catalog, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, ErrInvalidManifest
	}
	defer f.Close()
	return Read(f)
}
func Read(r io.Reader) (*Catalog, error) {
	data, err := io.ReadAll(io.LimitReader(r, 1048577))
	if err != nil || len(data) > 1048576 || !utf8.Valid(data) {
		return nil, ErrInvalidManifest
	}
	// Token-level object parsing rejects duplicate keys as well as unknown fields.
	dec := json.NewDecoder(strings.NewReader(string(data)))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		return nil, ErrInvalidManifest
	}
	key, err := dec.Token()
	if err != nil || key != "items" {
		return nil, ErrInvalidManifest
	}
	var entries []json.RawMessage
	if dec.Decode(&entries) != nil || entries == nil {
		return nil, ErrInvalidManifest
	}
	if dec.More() {
		return nil, ErrInvalidManifest
	}
	if tok, err = dec.Token(); err != nil || tok != json.Delim('}') {
		return nil, ErrInvalidManifest
	}
	if _, err = dec.Token(); err != io.EOF {
		return nil, ErrInvalidManifest
	}
	c := &Catalog{items: make([]openapi.AvatarPreset, 0, len(entries)), urls: map[string]string{}}
	for _, raw := range entries {
		d := json.NewDecoder(strings.NewReader(string(raw)))
		tok, err := d.Token()
		if err != nil || tok != json.Delim('{') {
			return nil, ErrInvalidManifest
		}
		fields := map[string]string{}
		for d.More() {
			k, e := d.Token()
			name, ok := k.(string)
			if e != nil || !ok {
				return nil, ErrInvalidManifest
			}
			if _, duplicate := fields[name]; duplicate {
				return nil, ErrInvalidManifest
			}
			switch name {
			case "id", "label", "imageUrl":
			default:
				return nil, ErrInvalidManifest
			}
			var value string
			if d.Decode(&value) != nil {
				return nil, ErrInvalidManifest
			}
			fields[name] = value
		}
		if _, err = d.Token(); err != nil {
			return nil, ErrInvalidManifest
		}
		id, label, url := fields["id"], fields["label"], fields["imageUrl"]
		if len(fields) != 3 || !presetID.MatchString(id) || strings.TrimSpace(label) != label || utf8.RuneCountInString(label) < 1 || utf8.RuneCountInString(label) > 120 || url != "/assets/avatars/presets/"+id+".svg" {
			return nil, ErrInvalidManifest
		}
		if _, duplicate := c.urls[id]; duplicate {
			return nil, ErrInvalidManifest
		}
		c.urls[id] = url
		c.items = append(c.items, openapi.AvatarPreset{Id: id, Label: label, ImageUrl: url})
	}
	return c, nil
}
func (c *Catalog) URL(id string) (string, bool)  { u, ok := c.urls[id]; return u, ok }
func (c *Catalog) Items() []openapi.AvatarPreset { return append([]openapi.AvatarPreset{}, c.items...) }
