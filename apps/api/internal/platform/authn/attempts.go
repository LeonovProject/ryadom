package authn

import (
	"container/heap"
	"errors"
	"net/mail"
	"net/netip"
	"strings"
	"sync"
	"time"
)

const MaxAttemptKeys = 10000

var ErrInvalidEmail = errors.New("invalid email address")

func CanonicalEmail(value string) (string, error) {
	if len(value) < 3 || len(value) > 254 {
		return "", ErrInvalidEmail
	}
	for i := 0; i < len(value); i++ {
		if value[i] < 0x21 || value[i] > 0x7e {
			return "", ErrInvalidEmail
		}
	}
	address, err := mail.ParseAddress(value)
	if err != nil || address.Name != "" || address.Address != value {
		return "", ErrInvalidEmail
	}
	return strings.ToLower(value), nil
}

type AttemptDecision struct {
	Allowed    bool
	RetryAfter int
}
type attemptKey struct {
	kind  uint8
	ip    netip.Addr
	email string
}
type attemptWindow struct {
	count   int
	expires time.Time
}
type expiry struct {
	key attemptKey
	at  time.Time
}
type expiries []expiry

func (e expiries) Len() int           { return len(e) }
func (e expiries) Less(i, j int) bool { return e[i].at.Before(e[j].at) }
func (e expiries) Swap(i, j int)      { e[i], e[j] = e[j], e[i] }
func (e *expiries) Push(value any)    { *e = append(*e, value.(expiry)) }
func (e *expiries) Pop() any {
	old := *e
	last := old[len(old)-1]
	old[len(old)-1] = expiry{}
	*e = old[:len(old)-1]
	return last
}

type AttemptLimiter struct {
	mu       sync.Mutex
	clock    Clock
	capacity int
	windows  map[attemptKey]*attemptWindow
	expires  expiries
}

func NewAttemptLimiter(clock Clock) *AttemptLimiter {
	return &AttemptLimiter{clock: clockOrNow(clock), capacity: MaxAttemptKeys, windows: map[attemptKey]*attemptWindow{}}
}

// CheckLogin consumes one attempt, including successful/failed/denied attempts.
// It must run before any expensive password work. There is no success-reset API.
func (l *AttemptLimiter) CheckLogin(ip netip.Addr, email string) (AttemptDecision, error) {
	canonical, err := CanonicalEmail(email)
	if err != nil {
		return AttemptDecision{}, err
	}
	if !ip.IsValid() || ip.Zone() != "" {
		return AttemptDecision{}, ErrInvalidClientIP
	}
	ip = ip.Unmap()
	return l.consume([]attemptSpec{{attemptKey{kind: 1, ip: ip}, 100, 15 * time.Minute}, {attemptKey{kind: 2, ip: ip, email: canonical}, 10, 15 * time.Minute}}), nil
}

func (l *AttemptLimiter) CheckRegister(ip netip.Addr) (AttemptDecision, error) {
	if !ip.IsValid() || ip.Zone() != "" {
		return AttemptDecision{}, ErrInvalidClientIP
	}
	return l.consume([]attemptSpec{{attemptKey{kind: 3, ip: ip.Unmap()}, 20, time.Hour}}), nil
}

type attemptSpec struct {
	key    attemptKey
	limit  int
	window time.Duration
}

func (l *AttemptLimiter) consume(specs []attemptSpec) AttemptDecision {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.clock()
	for len(l.expires) > 0 && !now.Before(l.expires[0].at) {
		old := heap.Pop(&l.expires).(expiry)
		delete(l.windows, old.key)
	}
	missing := 0
	for _, spec := range specs {
		if l.windows[spec.key] == nil {
			missing++
		}
	}
	capacityDenied := len(l.windows)+missing > l.capacity
	retry := time.Duration(0)
	if capacityDenied {
		retry = time.Second
		if len(l.expires) > 0 {
			retry = l.expires[0].at.Sub(now)
		}
	}
	for _, spec := range specs {
		window := l.windows[spec.key]
		if window == nil {
			if capacityDenied {
				continue
			}
			window = &attemptWindow{expires: now.Add(spec.window)}
			l.windows[spec.key] = window
			heap.Push(&l.expires, expiry{spec.key, window.expires})
		}
		// Saturate instead of overflowing while all later attempts stay denied.
		if window.count <= spec.limit {
			window.count++
		}
		if window.count > spec.limit && window.expires.Sub(now) > retry {
			retry = window.expires.Sub(now)
		}
	}
	if retry == 0 && !capacityDenied {
		return AttemptDecision{Allowed: true}
	}
	seconds := int((retry-1)/time.Second) + 1
	if seconds < 1 {
		seconds = 1
	}
	return AttemptDecision{RetryAfter: seconds}
}
