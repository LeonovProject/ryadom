package activitytypes

import (
	"golang.org/x/text/unicode/norm"
	"strings"
	"unicode/utf8"
)

// NormalizeName is shared by creation and administrative decisions.
func NormalizeName(raw string) (string, string, bool) {
	name := strings.Join(strings.Fields(norm.NFC.String(raw)), " ")
	valid := utf8.RuneCountInString(raw) <= 100 && name != "" && utf8.RuneCountInString(name) <= 100 && !strings.ContainsRune(name, 0)
	return name, strings.ToLower(name), valid
}
