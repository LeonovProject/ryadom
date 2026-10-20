package svg

import (
	"math"
	"strings"
)

var elementAttributes = map[string]string{
	"svg": " viewBox width height preserveAspectRatio ", "g": " ", "defs": " ",
	"path": " d pathLength ", "rect": " x y width height rx ry ", "circle": " cx cy r ",
	"ellipse": " cx cy rx ry ", "line": " x1 y1 x2 y2 ", "polyline": " points ", "polygon": " points ",
	"linearGradient": " id x1 y1 x2 y2 gradientUnits gradientTransform spreadMethod ",
	"radialGradient": " id cx cy r fx fy fr gradientUnits gradientTransform spreadMethod ",
	"stop":           " offset stop-color stop-opacity ",
}

const presentationAttributes = " fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset opacity transform "

func allowedAttribute(element, name string) bool {
	if strings.Contains(elementAttributes[element], " "+name+" ") {
		return true
	}
	switch element {
	case "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon":
		return strings.Contains(presentationAttributes, " "+name+" ")
	}
	return false
}

func (d *document) attribute(element, name, value string) (string, error) {
	switch name {
	case "id":
		if !idPattern.MatchString(value) || d.ids[value] {
			return "", invalid("ID градиента должен быть уникальным ASCII-именем длиной до 64.")
		}
		d.ids[value] = true
	case "fill", "stroke":
		if strings.HasPrefix(value, "url(#") && strings.HasSuffix(value, ")") {
			id := value[5 : len(value)-1]
			if !idPattern.MatchString(id) {
				return "", invalid("Разрешена только ссылка url(#id).")
			}
			d.refs = append(d.refs, id)
		} else {
			return color(value)
		}
	case "stop-color":
		return color(value)
	case "fill-rule":
		return enum(value, "nonzero", "evenodd")
	case "stroke-linecap":
		return enum(value, "butt", "round", "square")
	case "stroke-linejoin":
		return enum(value, "miter", "round", "bevel")
	case "gradientUnits":
		return enum(value, "objectBoundingBox", "userSpaceOnUse")
	case "spreadMethod":
		return enum(value, "pad", "reflect", "repeat")
	case "preserveAspectRatio":
		fields := strings.FieldsFunc(value, func(r rune) bool { return r == ' ' || r == '\t' || r == '\r' || r == '\n' })
		if len(fields) == 1 && fields[0] == "none" {
			return "none", nil
		}
		if len(fields) < 1 || len(fields) > 2 || (len(fields) == 2 && fields[1] != "meet" && fields[1] != "slice") {
			return "", invalid("Некорректный preserveAspectRatio.")
		}
		if _, err := enum(fields[0], "xMinYMin", "xMidYMin", "xMaxYMin", "xMinYMid", "xMidYMid", "xMaxYMid", "xMinYMax", "xMidYMax", "xMaxYMax"); err != nil {
			return "", err
		}
		return strings.Join(fields, " "), nil
	case "transform", "gradientTransform":
		return value, d.transform(value)
	case "d":
		return value, d.path(value)
	case "viewBox":
		ns, err := d.list(value, 4)
		if err != nil {
			return "", err
		}
		if len(ns) != 4 || ns[2] <= 0 || ns[3] <= 0 || ns[2] > maxDimension || ns[3] > maxDimension {
			return "", invalid("viewBox содержит четыре числа, ширина и высота — от 0 до 4096, не включая 0.")
		}
	case "points":
		ns, err := d.list(value, maxPoints*2)
		if err != nil {
			return "", err
		}
		if len(ns) == 0 || len(ns)%2 != 0 {
			return "", invalid("points должен содержать пары координат.")
		}
	case "stroke-dasharray":
		if value == "none" {
			return value, nil
		}
		ns, err := d.list(value, 32)
		if err != nil {
			return "", err
		}
		positive := false
		for _, n := range ns {
			if n < 0 {
				return "", invalid("Длины штрихов неотрицательны.")
			}
			positive = positive || n > 0
		}
		if !positive {
			return "", invalid("Хотя бы одна длина штриха должна быть положительной.")
		}
	default:
		numeric := value
		percent := false
		gradient := element == "linearGradient" || element == "radialGradient"
		if name == "offset" || (gradient && name != "id") {
			if strings.HasSuffix(numeric, "%") {
				percent = true
				numeric = strings.TrimSuffix(numeric, "%")
			}
		}
		if element == "svg" && (name == "width" || name == "height") {
			numeric = strings.TrimSuffix(numeric, "px")
		}
		n, err := d.scalar(numeric)
		if err != nil {
			return "", err
		}
		if percent && (n < 0 || n > 100) {
			return "", invalid("Проценты должны лежать в пределах 0..100.")
		}
		switch name {
		case "width", "height":
			if n < 0 || (element == "svg" && (n <= 0 || n > maxDimension)) {
				return "", invalid("Недопустимый размер SVG.")
			}
		case "r", "rx", "ry", "fr", "stroke-width":
			if n < 0 {
				return "", invalid("Размер или радиус не может быть отрицательным.")
			}
		case "pathLength":
			if n <= 0 {
				return "", invalid("pathLength должен быть положительным.")
			}
		case "opacity", "fill-opacity", "stroke-opacity", "stop-opacity":
			if n < 0 || n > 1 {
				return "", invalid("Непрозрачность должна лежать в пределах 0..1.")
			}
		case "offset":
			if !percent && (n < 0 || n > 1) {
				return "", invalid("offset должен лежать в пределах 0..1 либо 0..100%.")
			}
		case "stroke-miterlimit":
			if n < 1 || n > 10 {
				return "", invalid("stroke-miterlimit должен лежать в пределах 1..10.")
			}
		}
	}
	return value, nil
}

func enum(value string, allowed ...string) (string, error) {
	for _, candidate := range allowed {
		if value == candidate {
			return value, nil
		}
	}
	return "", invalid("Неподдерживаемое значение атрибута SVG.")
}
func color(value string) (string, error) {
	switch value {
	case "none", "black", "white", "transparent":
		return value, nil
	}
	if len(value) == 4 || len(value) == 5 || len(value) == 7 || len(value) == 9 {
		if value[0] == '#' {
			for _, c := range value[1:] {
				if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
					return "", invalid("Неподдерживаемый цвет.")
				}
			}
			return strings.ToLower(value), nil
		}
	}
	return "", invalid("Допустим hex-цвет, none, black, white или transparent.")
}

func (d *document) transform(value string) error {
	s := scanner{text: value}
	count := 0
	for {
		s.spaces()
		if s.end() {
			if count == 0 {
				return invalid("Пустое преобразование.")
			}
			return nil
		}
		start := s.pos
		for !s.end() && ((s.text[s.pos] >= 'a' && s.text[s.pos] <= 'z') || (s.text[s.pos] >= 'A' && s.text[s.pos] <= 'Z')) {
			s.pos++
		}
		name := s.text[start:s.pos]
		s.spaces()
		if !s.take('(') {
			return invalid("Некорректное преобразование.")
		}
		start = s.pos
		for !s.end() && s.text[s.pos] != ')' {
			s.pos++
		}
		if s.end() {
			return invalid("Незакрытое преобразование.")
		}
		ns, err := d.list(s.text[start:s.pos], 6)
		if err != nil {
			return err
		}
		s.pos++
		switch name {
		case "matrix":
			if len(ns) != 6 {
				return invalid("matrix требует шесть чисел.")
			}
			for _, n := range ns[:4] {
				if math.Abs(n) > 100 {
					return invalid("Коэффициент matrix превышает 100.")
				}
			}
		case "translate", "scale":
			if len(ns) != 1 && len(ns) != 2 {
				return invalid("translate/scale требуют одно или два числа.")
			}
			if name == "scale" {
				for _, n := range ns {
					if math.Abs(n) > 100 {
						return invalid("Модуль scale превышает 100.")
					}
				}
			}
		case "rotate":
			if len(ns) != 1 && len(ns) != 3 {
				return invalid("rotate требует одно или три числа.")
			}
		case "skewX", "skewY":
			if len(ns) != 1 || math.Abs(ns[0]) >= 85 {
				return invalid("Модуль skew должен быть меньше 85 градусов.")
			}
		default:
			return invalid("Неподдерживаемое преобразование.")
		}
		count++
		if count > maxTransforms {
			return invalid("Допустимо не более восьми преобразований.")
		}
		gap := s.spaces()
		if s.take(',') {
			s.spaces()
			if s.end() {
				return invalid("Лишняя запятая после преобразования.")
			}
		} else if !s.end() && !gap {
			return invalid("Между преобразованиями нужен разделитель.")
		}
	}
}
