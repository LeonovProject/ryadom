// Package svg validates and normalizes the project's restricted SVG 1.0.0 profile.
// It never fetches resources, repairs unsupported graphics or persists partial data.
package svg

import (
	"encoding/xml"
	"io"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
	openapi "github.com/LeonovProject/ryadom/apps/api/internal/transport/openapi"
)

const (
	ProfileVersion    = "1.0.0"
	Namespace         = "http://www.w3.org/2000/svg"
	MaxBytes          = 131072
	maxDepth          = 16
	maxElements       = 512
	maxAttributes     = 32
	maxAttributeBytes = 32768
	maxSegments       = 4096
	maxNumbers        = 16384
	maxPoints         = 2048
	maxTransforms     = 8
	maxGradients      = 32
	maxStops          = 256
	maxIDLength       = 64
	maxDimension      = 4096
	maxNumber         = 1000000
)

var declaration = regexp.MustCompile(`^version[\x20\x09\x0d\x0a]*=[\x20\x09\x0d\x0a]*(?:"1\.0"|'1\.0')(?:[\x20\x09\x0d\x0a]+encoding[\x20\x09\x0d\x0a]*=[\x20\x09\x0d\x0a]*(?:"(?i:UTF-8)"|'(?i:UTF-8)'))?(?:[\x20\x09\x0d\x0a]+standalone[\x20\x09\x0d\x0a]*=[\x20\x09\x0d\x0a]*(?:"(?:yes|no)"|'(?:yes|no)'))?[\x20\x09\x0d\x0a]*$`)
var idPattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_-]{0,63}$`)

func invalid(message string) error {
	e := fault.New(422, openapi.ErrorCodeVALIDATIONERROR, "SVG не соответствует разрешённому профилю.")
	e.Fields["/svg"] = []string{message}
	return e
}
func tooLarge() error {
	e := fault.New(413, openapi.ErrorCodePAYLOADTOOLARGE, "SVG превышает 128 КиБ.")
	e.Fields["/svg"] = []string{"Допустимо не более 131072 байт UTF-8 до и после нормализации."}
	return e
}

type document struct {
	elements, numbers, segments, gradients, stops int
	defs                                          bool
	ids                                           map[string]bool
	refs                                          []string
}

// Normalize returns a complete canonical document or an empty string and a safe
// application error (413 for size, 422 with /svg for content/complexity). Callers
// must validate before updating SVG, moderation state or revision in their tx.
func Normalize(input string) (string, error) {
	if len(input) > MaxBytes {
		return "", tooLarge()
	}
	if !utf8.ValidString(input) {
		return "", invalid("Требуется корректный UTF-8.")
	}
	dec := xml.NewDecoder(strings.NewReader(input))
	dec.Strict = true // Entity and CharsetReader deliberately remain nil.
	doc := document{ids: make(map[string]bool)}
	var stack []string
	var tokens []xml.Token
	rootSeen, rootClosed := false, false
	for {
		before := dec.InputOffset()
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", invalid("Некорректный XML.")
		}
		switch t := tok.(type) {
		case xml.StartElement:
			if rootClosed || len(stack) >= maxDepth {
				return "", invalid("Допустим один корень и глубина до 16.")
			}
			doc.elements++
			if doc.elements > maxElements {
				return "", invalid("Допустимо не более 512 элементов.")
			}
			root := len(stack) == 0
			if t.Name.Space != Namespace || (root && t.Name.Local != "svg") {
				return "", invalid("Элементы должны принадлежать пространству имён SVG.")
			}
			if root {
				rootSeen = true
			} else if !doc.childAllowed(stack[len(stack)-1], t.Name.Local) {
				return "", invalid("Недопустимый элемент или его расположение.")
			}
			if t.Name.Local == "defs" {
				if doc.defs {
					return "", invalid("Разрешён один defs в корне.")
				}
				doc.defs = true
			}
			if t.Name.Local == "linearGradient" || t.Name.Local == "radialGradient" {
				doc.gradients++
				if doc.gradients > maxGradients {
					return "", invalid("Допустимо не более 32 градиентов.")
				}
			}
			if t.Name.Local == "stop" {
				doc.stops++
				if doc.stops > maxStops {
					return "", invalid("Допустимо не более 256 stop.")
				}
			}
			attrs, err := doc.attributes(t, root)
			if err != nil {
				return "", err
			}
			// Local names plus one explicit root xmlns avoid encoding/xml repeating the
			// namespace on each element. Every name/attribute has already been checked.
			tokens = append(tokens, xml.StartElement{Name: xml.Name{Local: t.Name.Local}, Attr: attrs})
			stack = append(stack, t.Name.Local)
		case xml.EndElement:
			if len(stack) == 0 || t.Name.Space != Namespace || t.Name.Local != stack[len(stack)-1] {
				return "", invalid("Некорректное закрытие элемента.")
			}
			stack = stack[:len(stack)-1]
			tokens = append(tokens, xml.EndElement{Name: xml.Name{Local: t.Name.Local}})
			if len(stack) == 0 {
				rootClosed = true
			}
		case xml.CharData:
			if trim(string(t)) != "" {
				return "", invalid("Текстовые узлы не поддерживаются.")
			}
		case xml.Comment:
			if rootClosed {
				return "", invalid("После корня допустим только пробел.")
			}
			// Comments have no graphical effect and are intentionally omitted.
		case xml.ProcInst:
			if before != 0 || t.Target != "xml" || !declaration.MatchString(strings.TrimLeft(string(t.Inst), " \t\r\n")) {
				return "", invalid("Разрешена только начальная XML-декларация 1.0 UTF-8.")
			}
		default:
			return "", invalid("XML-директивы запрещены.")
		}
	}
	if !rootSeen || !rootClosed || len(stack) != 0 {
		return "", invalid("Требуется один завершённый корень svg.")
	}
	for _, id := range doc.refs {
		if !doc.ids[id] {
			return "", invalid("Ссылка должна указывать на существующий градиент.")
		}
	}
	out := &limitedOutput{}
	enc := xml.NewEncoder(out)
	for _, tok := range tokens {
		if err := enc.EncodeToken(tok); err != nil {
			return "", err
		}
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return out.String(), nil
}

func (*document) childAllowed(parent, child string) bool {
	switch parent {
	case "svg", "g":
		return child == "g" || child == "path" || child == "rect" || child == "circle" || child == "ellipse" || child == "line" || child == "polyline" || child == "polygon" || (parent == "svg" && child == "defs")
	case "defs":
		return child == "linearGradient" || child == "radialGradient"
	case "linearGradient", "radialGradient":
		return child == "stop"
	}
	return false
}

type limitedOutput struct{ strings.Builder }

func (o *limitedOutput) Write(p []byte) (int, error) {
	if len(p) > MaxBytes-o.Len() {
		return 0, tooLarge()
	}
	return o.Builder.Write(p)
}
func trim(s string) string { return strings.Trim(s, " \t\r\n") }

func (d *document) attributes(element xml.StartElement, root bool) ([]xml.Attr, error) {
	if len(element.Attr) > maxAttributes {
		return nil, invalid("Слишком много атрибутов.")
	}
	attrs := make([]xml.Attr, 0, len(element.Attr))
	seen := make(map[xml.Name]bool)
	for _, a := range element.Attr {
		if seen[a.Name] {
			return nil, invalid("Повторяющиеся атрибуты запрещены.")
		}
		seen[a.Name] = true
		if len(a.Value) > maxAttributeBytes {
			return nil, invalid("Значение атрибута превышает 32768 байт UTF-8.")
		}
		if a.Name.Space != "" {
			return nil, invalid("Дополнительные пространства имён и префиксы запрещены.")
		}
		if a.Name.Local == "xmlns" {
			if !root || a.Value != Namespace {
				return nil, invalid("xmlns допустим только на корне SVG.")
			}
		} else {
			if !allowedAttribute(element.Name.Local, a.Name.Local) {
				return nil, invalid("Неподдерживаемый атрибут SVG.")
			}
			if a.Name.Local == "id" && a.Value != trim(a.Value) {
				return nil, invalid("ID не должен содержать пробелы.")
			}
			value, err := d.attribute(element.Name.Local, a.Name.Local, trim(a.Value))
			if err != nil {
				return nil, err
			}
			a.Value = value
		}
		attrs = append(attrs, a)
	}
	if root && (!seen[xml.Name{Local: "xmlns"}] || !seen[xml.Name{Local: "viewBox"}]) {
		return nil, invalid("Корню нужны xmlns и viewBox.")
	}
	sort.Slice(attrs, func(i, j int) bool { return attrs[i].Name.Local < attrs[j].Name.Local })
	return attrs, nil
}
