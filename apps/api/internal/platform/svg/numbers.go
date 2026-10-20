package svg

import (
	"math"
	"strconv"
)

// scanner consumes SVG's ASCII numeric grammar without accepting Go-specific
// literals, NaN, infinities or arbitrary punctuation. Lists and path commands
// impose their own separator rules on this shared lexical scanner.
type scanner struct {
	text string
	pos  int
}

func (s *scanner) end() bool { return s.pos == len(s.text) }
func (s *scanner) take(c byte) bool {
	if !s.end() && s.text[s.pos] == c {
		s.pos++
		return true
	}
	return false
}
func (s *scanner) spaces() bool {
	start := s.pos
	for !s.end() {
		c := s.text[s.pos]
		if c != ' ' && c != '\t' && c != '\r' && c != '\n' {
			break
		}
		s.pos++
	}
	return s.pos > start
}
func digit(c byte) bool { return c >= '0' && c <= '9' }
func (s *scanner) number() (float64, error) {
	start := s.pos
	if !s.end() && (s.text[s.pos] == '+' || s.text[s.pos] == '-') {
		s.pos++
	}
	before := s.pos
	for !s.end() && digit(s.text[s.pos]) {
		s.pos++
	}
	digits := s.pos - before
	if s.take('.') {
		frac := s.pos
		for !s.end() && digit(s.text[s.pos]) {
			s.pos++
		}
		// SVG 2 does not permit a trailing decimal point.
		if s.pos == frac {
			return 0, invalid("После десятичной точки нужны цифры.")
		}
		digits += s.pos - frac
	}
	if digits == 0 {
		return 0, invalid("Ожидалось число SVG.")
	}
	if !s.end() && (s.text[s.pos] == 'e' || s.text[s.pos] == 'E') {
		s.pos++
		if !s.end() && (s.text[s.pos] == '+' || s.text[s.pos] == '-') {
			s.pos++
		}
		exponent := s.pos
		for !s.end() && digit(s.text[s.pos]) {
			s.pos++
		}
		if s.pos == exponent {
			return 0, invalid("Некорректный показатель степени.")
		}
	}
	n, err := strconv.ParseFloat(s.text[start:s.pos], 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || math.Abs(n) > maxNumber {
		return 0, invalid("Требуется конечное число с модулем до 1000000.")
	}
	return n, nil
}
func (d *document) number(s *scanner) (float64, error) {
	n, err := s.number()
	if err != nil {
		return 0, err
	}
	d.numbers++
	if d.numbers > maxNumbers {
		return 0, invalid("Допустимо не более 16384 числовых значений.")
	}
	return n, nil
}
func (d *document) scalar(value string) (float64, error) {
	s := scanner{text: value}
	n, err := d.number(&s)
	if err != nil {
		return 0, err
	}
	if !s.end() {
		return 0, invalid("Неподдерживаемые единицы или лишние символы числа.")
	}
	return n, nil
}
func (d *document) list(value string, limit int) ([]float64, error) {
	s := scanner{text: value}
	s.spaces()
	var result []float64
	for {
		if s.end() {
			return nil, invalid("Пустой список чисел или лишняя запятая.")
		}
		n, err := d.number(&s)
		if err != nil {
			return nil, err
		}
		result = append(result, n)
		if len(result) > limit {
			return nil, invalid("Слишком много чисел в атрибуте.")
		}
		gap := s.spaces()
		if s.end() {
			return result, nil
		}
		if s.take(',') {
			s.spaces()
		} else if !gap {
			return nil, invalid("Между числами нужен разделитель.")
		}
	}
}

func command(c byte) bool {
	switch c {
	case 'M', 'm', 'L', 'l', 'H', 'h', 'V', 'v', 'C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a', 'Z', 'z':
		return true
	}
	return false
}
func upper(c byte) byte {
	if c >= 'a' && c <= 'z' {
		return c - 32
	}
	return c
}
func (d *document) segment() error {
	d.segments++
	if d.segments > maxSegments {
		return invalid("Допустимо не более 4096 сегментов path.")
	}
	return nil
}
func (d *document) path(value string) error {
	s := scanner{text: value}
	s.spaces()
	if s.end() || upper(s.text[s.pos]) != 'M' {
		return invalid("Первая команда path должна быть M/m.")
	}
	for !s.end() {
		cmd := s.text[s.pos]
		if !command(cmd) {
			return invalid("Неизвестная команда path.")
		}
		s.pos++
		s.spaces()
		c := upper(cmd)
		if c == 'Z' {
			if err := d.segment(); err != nil {
				return err
			}
			continue
		}
		arity := map[byte]int{'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7}[c]
		for {
			for i := 0; i < arity; i++ {
				if i > 0 {
					gap := s.spaces()
					comma := s.take(',')
					if comma {
						s.spaces()
					}
					if c == 'A' && i == 3 && !gap && !comma {
						return invalid("Перед флагом дуги нужен разделитель.")
					}
				}
				if c == 'A' && (i == 3 || i == 4) {
					// Flags are one lexical character, including compact arc forms 01.
					if s.end() || (s.text[s.pos] != '0' && s.text[s.pos] != '1') {
						return invalid("Флаги дуги должны быть 0 или 1.")
					}
					if _, err := d.scalar(s.text[s.pos : s.pos+1]); err != nil {
						return err
					}
					s.pos++
				} else {
					n, err := d.number(&s)
					if err != nil {
						return err
					}
					if c == 'A' && i < 2 && n < 0 {
						return invalid("Радиусы дуги неотрицательны.")
					}
				}
			}
			// Each argument group is a segment, including extra moveto pairs (lineto).
			if err := d.segment(); err != nil {
				return err
			}
			s.spaces()
			if s.end() || command(s.text[s.pos]) {
				break
			}
			if s.take(',') {
				s.spaces()
				if s.end() || command(s.text[s.pos]) {
					return invalid("Лишняя запятая в path.")
				}
			}
		}
	}
	return nil
}
