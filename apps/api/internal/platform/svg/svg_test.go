package svg

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/fault"
)

const start = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">`

func wrap(body string) string { return start + body + `</svg>` }
func check(t *testing.T, input string, want int) string {
	t.Helper()
	out, err := Normalize(input)
	if want == 0 {
		if err != nil {
			t.Fatalf("unexpected rejection: %v", err)
		}
		again, err := Normalize(out)
		if err != nil || again != out {
			t.Fatalf("not idempotent: %v", err)
		}
		if len(out) > MaxBytes || strings.Count(out, `xmlns=`) != 1 || strings.Contains(out, `<!--`) {
			t.Fatal("invalid normalized output")
		}
	} else {
		if err == nil || out != "" {
			t.Fatal("expected failure without partial output")
		}
		var f *fault.Error
		if !errors.As(err, &f) || f.Status != want || len(f.Fields["/svg"]) == 0 {
			t.Fatalf("unsafe/wrong error: %#v", err)
		}
		code := "VALIDATION_ERROR"
		if want == 413 {
			code = "PAYLOAD_TOO_LARGE"
		}
		if string(f.Code) != code {
			t.Fatalf("wrong code %s", f.Code)
		}
	}
	return out
}

func repository(t *testing.T) string {
	t.Helper()
	p, err := filepath.Abs("../../../../..")
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func TestSharedConformance(t *testing.T) {
	root := repository(t)
	data, err := os.ReadFile(filepath.Join(root, "packages/contracts/examples/svg-cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases struct {
		PolicyVersion string
		Cases         []struct {
			Name, SVG, File string
			Valid           bool
			Status          int
			Code            string
			Recipe          struct {
				Kind             string
				Value            int
				PaddingCharacter string
			}
		}
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	if cases.PolicyVersion != ProfileVersion || len(cases.Cases) != 35 {
		t.Fatal("unexpected shared suite")
	}
	for _, c := range cases.Cases {
		t.Run(c.Name, func(t *testing.T) {
			input := c.SVG
			if c.File != "" {
				raw, err := os.ReadFile(filepath.Join(root, "packages/contracts/examples", c.File))
				if err != nil {
					t.Fatal(err)
				}
				input = string(raw)
			}
			switch c.Recipe.Kind {
			case "utf8Bytes":
				character := c.Recipe.PaddingCharacter
				if character == "" {
					character = "x"
				}
				base := wrap(`<!---->`)
				remaining := c.Recipe.Value - len(base)
				input = wrap(`<!--` + strings.Repeat(character, remaining/len(character)) + strings.Repeat("x", remaining%len(character)) + `-->`)
				if len(input) != c.Recipe.Value {
					t.Fatal("incorrect UTF-8 recipe")
				}
			case "depth":
				input = wrap(strings.Repeat(`<g>`, c.Recipe.Value-1) + strings.Repeat(`</g>`, c.Recipe.Value-1))
			case "elements":
				input = wrap(strings.Repeat(`<circle/>`, c.Recipe.Value-1))
			case "segments":
				input = wrap(`<path d="M0 0` + strings.Repeat(` 1 1`, c.Recipe.Value-1) + `"/>`)
			case "":
			default:
				t.Fatal("unknown recipe")
			}
			want := c.Status
			if c.Valid {
				want = 0
			}
			check(t, input, want)
		})
	}
}

func TestSharedPolicyParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(repository(t), "packages/contracts/svg-policy.json"))
	if err != nil {
		t.Fatal(err)
	}
	var p struct {
		Version, Namespace     string
		Limits                 map[string]int
		Elements               map[string][]string
		PresentationAttributes []string
	}
	if err = json.Unmarshal(raw, &p); err != nil {
		t.Fatal(err)
	}
	expected := map[string]int{"inputUtf8Bytes": MaxBytes, "normalizedUtf8Bytes": MaxBytes, "xmlDepth": maxDepth, "elements": maxElements, "attributesPerElement": maxAttributes, "attributeUtf8Bytes": maxAttributeBytes, "pathSegmentsTotal": maxSegments, "numbersTotal": maxNumbers, "pointsPerElement": maxPoints, "transformsPerAttribute": maxTransforms, "gradients": maxGradients, "stopsTotal": maxStops, "idLength": maxIDLength, "viewportDimension": maxDimension, "absoluteNumber": maxNumber}
	if p.Version != ProfileVersion || p.Namespace != Namespace || !reflect.DeepEqual(p.Limits, expected) {
		t.Fatal("implementation differs from policy")
	}
	if len(p.Elements) != len(elementAttributes) {
		t.Fatal("element drift")
	}
	for name, attrs := range p.Elements {
		if strings.Join(attrs, " ") != strings.Join(strings.Fields(elementAttributes[name]), " ") {
			t.Fatalf("attribute drift %s", name)
		}
	}
	if strings.Join(p.PresentationAttributes, " ") != strings.Join(strings.Fields(presentationAttributes), " ") {
		t.Fatal("presentation drift")
	}
}

func TestXMLBoundaries(t *testing.T) {
	valid := []string{
		`<?xml version="1.0" encoding="UTF-8" standalone="no"?>` + wrap(`<!--discard--><g/>`),
		`<?xml version='1.0' encoding='utf-8'?>` + wrap("\n\t"),
		wrap(`<rect x="&#x31;" width="1e2" fill="#ABCD"/>`),
		wrap(`<rect fill="url(#g)"/><defs><linearGradient id="g"><stop offset="100%" stop-color="#AABBCCDD"/></linearGradient></defs>`),
	}
	for _, input := range valid {
		check(t, input, 0)
	}
	invalids := []string{
		"", string([]byte{255}), "\ufeff" + wrap(""), wrap("") + wrap(""), wrap("") + "text", wrap("") + "<!--after-->", `<svg viewBox="0 0 1 1"/>`,
		`<?xml version="1.1"?>` + wrap(""), ` <?xml version="1.0"?>` + wrap(""), `<?xml version="1.0" encoding="ISO-8859-1"?>` + wrap(""),
		`<?xml encoding="UTF-8" version="1.0"?>` + wrap(""), wrap(`<?xml version="1.0"?>`), `<!DOCTYPE svg SYSTEM "file:///etc/passwd">` + wrap(""), wrap(`&unknown;`),
		wrap(`<svg viewBox="0 0 1 1"/>`), wrap(`<g xmlns="http://www.w3.org/2000/svg"/>`),
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:q="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>`,
		wrap(`<g xml:space="preserve"/>`), wrap(`<circle r="1" r="2"/>`), wrap(`<g><defs/></g>`), wrap(`<defs/><defs/>`), wrap(`<defs><rect/></defs>`), wrap(`<linearGradient/>`), wrap(`<defs><linearGradient><g/></linearGradient></defs>`), wrap(`<circle><path/></circle>`), wrap(`<stop/>`), wrap(`<defs><radialGradient><stop><stop/></stop></radialGradient></defs>`),
		wrap(`<g></circle>`), wrap(`<circle r="1"/`), wrap(`<path d="M0 0" class="x"/>`),
	}
	for i, input := range invalids {
		t.Run(fmt.Sprint(i), func(t *testing.T) { check(t, input, 422) })
	}
}

func TestAttributeGrammar(t *testing.T) {
	valid := []string{
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1000000 0 4096 4096" width="4096px" height="1" preserveAspectRatio="xMaxYMax   slice"><rect x="-1e6" y="+0.5" width="0" height="0" rx="0" ry="0" pathLength="1"/></svg>`,
	}
	// pathLength is only valid on path; use it separately below.
	valid[0] = strings.ReplaceAll(valid[0], ` pathLength="1"`, "")
	valid = append(valid, wrap(`<path pathLength=".1" d="M0 0" fill="#aBc" stroke="transparent" fill-opacity="0" opacity="1" stroke-opacity=".5" stroke-width="0" stroke-miterlimit="10" stroke-dasharray="0, 1 2" stroke-dashoffset="-1e6" stroke-linecap="round" stroke-linejoin="bevel" fill-rule="evenodd"/>`), wrap(`<defs><radialGradient id="X_0-a" cx="-1e6" cy="100%" r="0" fx=".5" fy="0%" fr="10%" gradientUnits="userSpaceOnUse" spreadMethod="reflect"><stop offset=".5" stop-opacity="1" stop-color="black"/></radialGradient></defs>`))
	for _, input := range valid {
		check(t, input, 0)
	}
	attrs := []string{`width=""`, `width="0"`, `height="-1"`, `width="4097"`, `width="1%"`, `width="1 px"`, `viewBox="0 0 1"`, `viewBox="0 0 1 1 1"`, `viewBox="0 0 0 1"`, `viewBox="0 0 4097 1"`, `preserveAspectRatio="none meet"`, `preserveAspectRatio="xMidYMid slice"`, `preserveAspectRatio="xMidYMid wrong"`, `viewBox="0 0 NaN 1"`}
	for _, a := range attrs {
		input := start
		key := strings.SplitN(a, "=", 2)[0]
		if key == "viewBox" {
			input = strings.Replace(input, `viewBox="0 0 256 256"`, a, 1)
		} else {
			input = strings.TrimSuffix(input, ">") + " " + a + ">"
		}
		check(t, input+`</svg>`, 422)
	}
	attrs = []string{`fill="red"`, `fill="rgb(0,0,0)"`, `fill="currentColor"`, `fill="url(#x) black"`, `fill="url( #x )"`, `fill="#GGG"`, `fill="#12"`, `stroke-width="-1"`, `opacity="1.01"`, `fill-opacity="-0.1"`, `stroke-opacity="2"`, `stroke-miterlimit="0"`, `stroke-miterlimit="11"`, `stroke-dasharray="0,0"`, `stroke-dasharray="1,-1"`, `stroke-dasharray="1,,2"`, `stroke-dasharray="1,"`, `stroke-dasharray="1-2"`, `stroke-dasharray="1%"`, `stroke-linejoin="arcs"`, `cx="0x1"`, `cy="1e1000"`, `r="-1"`, `r="1em"`, `r="Inf"`, `cx="1e"`, `cx=".1.2"`, `cx="1."`, `cx="1000001"`}
	for _, a := range attrs {
		check(t, wrap(`<circle `+a+`/>`), 422)
	}
	check(t, wrap(`<path pathLength="0"/>`), 422)
	for _, attrs := range []string{`r="-1"`, `cx="101%"`, `cy="-1%"`, `fr="-1"`, `id="1bad"`, `id=" x "`, `id="abc def"`, `gradientUnits="unknown"`, `spreadMethod="unknown"`} {
		check(t, wrap(`<defs><radialGradient `+attrs+`/></defs>`), 422)
	}
	for _, attrs := range []string{`offset="1.1"`, `offset="101%"`, `stop-opacity="-1"`, `stop-color="url(#x)"`} {
		check(t, wrap(`<defs><linearGradient><stop `+attrs+`/></linearGradient></defs>`), 422)
	}
}

func TestPathGrammar(t *testing.T) {
	valid := []string{`M.6.5L100-200H1V2C1 2 3 4 5 6S1 2 3 4Q1 2 3 4T1 2A10 20 -30 01-2-3Z`, `m0 0 1 1 2 2l1 1h1v1c1 2 3 4 5 6s1 2 3 4q1 2 3 4t1 2a0 1 0 0 1 2 3z m0 0`, `M1e-2,+2E+2 L.1 .2,.3 .4 Z Z`}
	for _, s := range valid {
		check(t, wrap(`<path d="`+s+`"/>`), 0)
	}
	bad := []string{"", `L0 0`, `M0`, `M0 0R1 1`, `M0 0L1 1 2`, `M0 0C1 2 3 4 5`, `M0 0S1 2 3`, `M0 0Q1 2 3`, `M0 0T1`, `M0 0A1 1 0 0 1 2`, `M0 0A-1 1 0 0 1 2 2`, `M0 0A1 1 0 2 0 1 1`, `M0 0A1 1 0 0.0 1 1 1`, `M0 0A1 1 0+1 0 1 1`, `M0 0A1 1 0 -0 1 1 1`, `M,0 0`, `M0,,0`, `M0 0,`, `M0 0,L1 1`, `M0 0Z1 1`, `M0 0Z,`, `M0 0L1e 1`, `M0 0LNaN 1`}
	for _, s := range bad {
		check(t, wrap(`<path d="`+s+`"/>`), 422)
	}
}
func TestTransformGrammar(t *testing.T) {
	good := []string{`matrix(100 -100 0 1 1000000 -1000000)`, `translate(1) scale(-100,100) rotate(10 1 2) skewX(-84.999) skewY(84.999)`, `translate(1,2),scale(.1)`, `rotate(0)`, `scale(0)`}
	for _, s := range good {
		check(t, wrap(`<g transform="`+s+`"/>`), 0)
		check(t, wrap(`<defs><linearGradient gradientTransform="`+s+`"/></defs>`), 0)
	}
	bad := []string{"", `matrix(1 2 3 4 5)`, `matrix(101 0 0 1 0 0)`, `translate()`, `translate(1 2 3)`, `scale(101)`, `rotate(1 2)`, `skewX(85)`, `skewY(-85)`, `skewX(1 2)`, `foo(1)`, `scale(1`, `scale((1))`, `scale(1)garbage`, `scale(1)scale(2)`, `scale(1),`, `scale(1),,scale(2)`, `translate(,1)`, `translate(1,)`}
	for _, s := range bad {
		check(t, wrap(`<g transform="`+s+`"/>`), 422)
	}
}

func TestComplexityBoundaries(t *testing.T) {
	for _, delta := range []int{0, 1} {
		want := 0
		if delta == 1 {
			want = 422
		}
		t.Run(fmt.Sprint("attributeBytes", delta), func(t *testing.T) {
			d := "M" + strings.Repeat(" ", maxAttributeBytes-4+delta) + "0 0"
			if len(d) != maxAttributeBytes+delta {
				t.Fatal("bad fixture")
			}
			check(t, wrap(`<path d="`+d+`"/>`), want)
		})
		check(t, wrap(`<polyline points="`+strings.TrimSpace(strings.Repeat("0 0 ", maxPoints+delta))+`"/>`), want)
		check(t, wrap(`<g transform="`+strings.TrimSpace(strings.Repeat("scale(1) ", maxTransforms+delta))+`"/>`), want)
		check(t, wrap(`<defs>`+strings.Repeat(`<linearGradient/>`, maxGradients+delta)+`</defs>`), want)
		check(t, wrap(`<defs><radialGradient>`+strings.Repeat(`<stop/>`, maxStops+delta)+`</radialGradient></defs>`), want)
		check(t, wrap(`<defs><linearGradient id="`+strings.Repeat("x", maxIDLength+delta)+`"/></defs>`), want)
		check(t, wrap(`<circle stroke-dasharray="`+strings.TrimSpace(strings.Repeat("1 ", 32+delta))+`"/>`), want)
		// 4 viewBox scalars, 2 M scalars, 2729 C groups * 6, then four H.
		d := `M0 0` + strings.Repeat(`C0 0 0 0 0 0`, 2729) + strings.Repeat(`H0`, 4+delta)
		check(t, wrap(`<path d="`+d+`"/>`), want)
	}

	// Compact arc groups count both flags as numbers, across implicit repeats.
	for _, delta := range []int{0, 1} {
		want := 0
		if delta == 1 {
			want = 422
		}
		arc := `M0 0A` + strings.TrimSpace(strings.Repeat(`0 0 0 0 0 0 0 `, 2339)) + strings.Repeat(`H0`, 5+delta)
		if len(arc) > maxAttributeBytes {
			t.Fatal("arc fixture too long")
		}
		check(t, wrap(`<path d="`+arc+`"/>`), want)
		stops := strings.Repeat(`<linearGradient>`+strings.Repeat(`<stop/>`, 16)+`</linearGradient>`, 16)
		if delta == 1 {
			stops = strings.Replace(stops, `</linearGradient>`, `<stop/></linearGradient>`, 1)
		}
		check(t, wrap(`<defs>`+stops+`</defs>`), want)
	}
	check(t, wrap(`<polygon points="0 0 1"/>`), 422)
	// The allowlist cannot yield 32 distinct attributes on any element; duplicate
	// and unknown attributes are rejected even below that independent ceiling.
	for _, n := range []int{32, 33} {
		check(t, wrap(`<g`+strings.Repeat(` opacity="1"`, n)+`/>`), 422)
	}
	check(t, wrap(`<path d="M0 0`+strings.Repeat(` 0 0`, 2047)+`"/><path d="M0 0`+strings.Repeat(` 0 0`, 2047)+`"/>`), 0)
	check(t, wrap(`<path d="M0 0`+strings.Repeat(` 0 0`, 2047)+`"/><path d="M0 0`+strings.Repeat(` 0 0`, 2048)+`"/>`), 422)
}

func expandedDocument(size int, short bool) string {
	// Four large but individually bounded d attributes; spaces inside a valid
	// command are preserved. Paired tags have the same length after normalization.
	const p = `<path d="M 0 0"></path>`
	base := wrap(strings.Repeat(p, 4))
	remaining := size - len(base)
	parts := make([]string, 4)
	for i := range parts {
		n := min(remaining, maxAttributeBytes-len("M 0 0"))
		parts[i] = `<path d="M ` + strings.Repeat(" ", n) + `0 0"></path>`
		remaining -= n
	}
	if remaining != 0 {
		panic("fixture capacity")
	}
	result := wrap(strings.Join(parts, ""))
	if short {
		result = strings.Replace(result, `"></path>`, `"/>`, 1)
	}
	return result
}
func TestNormalizedSizeBoundary(t *testing.T) {
	input := expandedDocument(MaxBytes, false)
	if len(input) != MaxBytes {
		t.Fatal("wrong input size")
	}
	out := check(t, input, 0)
	if len(out) != MaxBytes {
		t.Fatalf("wrong normalized size %d", len(out))
	}
	// Input fits, normalization expands the first empty element by 6 bytes.
	input = expandedDocument(MaxBytes+1, true)
	if len(input) > MaxBytes {
		t.Fatal("wrong expansion fixture")
	}
	check(t, input, 413)
}
func TestCanonicalSerialization(t *testing.T) {
	input := `<?xml version="1.0"?>` + wrap(`<g fill="#ABC"><!--x--><rect y="2" x="1" width="10"/></g>`)
	out := check(t, input, 0)
	want := `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><g fill="#abc"><rect width="10" x="1" y="2"></rect></g></svg>`
	if out != want {
		t.Fatalf("normalization: %s", out)
	}
	dec := xml.NewDecoder(strings.NewReader(out))
	elements := 0
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if e, ok := tok.(xml.StartElement); ok {
			elements++
			if e.Name.Space != Namespace {
				t.Fatal("namespace lost")
			}
		}
	}
	if elements != 3 {
		t.Fatal("lost elements")
	}
}

func FuzzNormalize(f *testing.F) {
	for _, s := range []string{wrap(``), wrap(`<path d="M0 0A1 1 0 01-2-3"/>`), wrap(`<g transform="translate(1 2)"/>`), wrap(`<defs><linearGradient id="x"/></defs><rect fill="url(#x)"/>`), wrap(`<script/>`), wrap(`<path d="M0,,0"/>`)} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, input string) {
		out, err := Normalize(input)
		if err != nil {
			if out != "" {
				t.Fatal("partial output")
			}
			var safe *fault.Error
			if !errors.As(err, &safe) || (safe.Status != 413 && safe.Status != 422) {
				t.Fatal("unsafe error")
			}
			return
		}
		if len(out) > MaxBytes || !bytes.HasPrefix([]byte(out), []byte("<svg ")) {
			t.Fatal("invalid output")
		}
		again, err := Normalize(out)
		if err != nil || again != out {
			t.Fatalf("unstable normalization: %v", err)
		}
	})
}

// Optional artifacts for an independent renderer; normal test runs do not write
// into the repository or need a graphics runtime.
func TestRenderingSamples(t *testing.T) {
	dir := os.Getenv("RYADOM_SVG_RENDER_DIR")
	if dir == "" {
		t.Skip("set RYADOM_SVG_RENDER_DIR to export rendering samples")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	root := repository(t)
	samples := map[string]string{}
	for name, path := range map[string]string{"avatar": "packages/contracts/avatar-presets/ryadom-companion.svg", "cover": "design/assets/event-covers/ryadom-meeting-point.svg"} {
		raw, err := os.ReadFile(filepath.Join(root, path))
		if err != nil {
			t.Fatal(err)
		}
		samples[name] = string(raw)
	}
	samples["gradient"] = wrap(`<rect width="256" height="256" fill="url(#red)"/><defs><linearGradient id="red"><stop offset="0" stop-color="#D92D3A"/><stop offset="100%" stop-color="#FFFFFF"/></linearGradient></defs>`)
	samples["geometry"] = wrap(`<g transform="translate(12 10) rotate(5 100 100) scale(.8)"><path d="M.6.5L100-20H180V100C180 150 120 200 100 180S20 100 30 90Q40 10 80 30T100 80A30 40 -30 01-2-3Z" fill="#aBCd" stroke="#123456" stroke-width="2"/><polygon points="150 150,200 170,160 230" fill="black"/></g>`)
	for name, input := range samples {
		normalized := check(t, input, 0)
		for suffix, data := range map[string]string{"source": input, "normalized": normalized} {
			if err := os.WriteFile(filepath.Join(dir, name+"-"+suffix+".svg"), []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
}
