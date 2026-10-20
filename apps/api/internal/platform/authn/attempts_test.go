package authn

import (
	"fmt"
	"net/netip"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCanonicalEmail(t *testing.T) {
	for _, input := range []string{"Alice+tag@Example.TEST", "a@b", "name.surname@example.test"} {
		canonical, err := CanonicalEmail(input)
		if err != nil || canonical == "" {
			t.Fatal(err)
		}
		if input == "Alice+tag@Example.TEST" && canonical != "alice+tag@example.test" {
			t.Fatal("alias changed", canonical)
		}
	}
	for _, input := range []string{"", " alice@example.test", "alice@example.test ", "а@example.test", "Name <a@b>", "a@@b", "a b@example.test", "a@b\n", "a@b,c@d", "a", string(make([]byte, 255))} {
		if _, err := CanonicalEmail(input); err == nil {
			t.Fatal("invalid email accepted")
		}
	}
}

func TestLoginLimitsAndWindowEdges(t *testing.T) {
	now := time.Unix(1792497600, 0)
	start := now
	l := NewAttemptLimiter(func() time.Time { return now })
	ip := netip.MustParseAddr("192.0.2.1")
	for i := 0; i < 10; i++ {
		decision, err := l.CheckLogin(ip, "Alice@Example.test")
		if err != nil || !decision.Allowed {
			t.Fatal("early pair limit", i, decision, err)
		}
	}
	if decision, err := l.CheckLogin(ip, "alice@example.test"); err != nil || decision.Allowed || decision.RetryAfter != 900 {
		t.Fatal("pair/canonical limit", decision, err)
	}
	if decision, _ := l.CheckLogin(ip, "bob@example.test"); !decision.Allowed {
		t.Fatal("pair limit affected another email")
	}
	if decision, _ := l.CheckLogin(netip.MustParseAddr("192.0.2.2"), "alice@example.test"); !decision.Allowed {
		t.Fatal("pair limit affected another IP")
	}
	now = start.Add(15*time.Minute - time.Nanosecond)
	if decision, _ := l.CheckLogin(ip, "alice@example.test"); decision.Allowed || decision.RetryAfter != 1 {
		t.Fatal("retry rounding", decision)
	}
	now = start.Add(15 * time.Minute)
	if decision, _ := l.CheckLogin(ip, "alice@example.test"); !decision.Allowed {
		t.Fatal("window did not expire")
	}
}

func TestDeniedAttemptsCountTowardIPAndKeepMaximumRetry(t *testing.T) {
	now := time.Unix(1792497600, 0)
	start := now
	l := NewAttemptLimiter(func() time.Time { return now })
	ip := netip.MustParseAddr("192.0.2.1")
	for i := 0; i < 100; i++ {
		decision, err := l.CheckLogin(ip, "alice@example.test")
		if err != nil {
			t.Fatal(err)
		}
		if i < 10 && !decision.Allowed {
			t.Fatal("early denial")
		}
		if i >= 10 && decision.Allowed {
			t.Fatal("pair limit bypass")
		}
	}
	if decision, _ := l.CheckLogin(ip, "fresh@example.test"); decision.Allowed || decision.RetryAfter != 900 {
		t.Fatal("denied attempts not counted toward IP", decision)
	}
	// A later pair window can outlast the IP window. The longest active limit wins.
	now = start.Add(10 * time.Minute)
	for i := 0; i < 10; i++ {
		_, _ = l.CheckLogin(ip, "later@example.test")
	}
	decision, _ := l.CheckLogin(ip, "later@example.test")
	if decision.Allowed || decision.RetryAfter != 900 {
		t.Fatal("max retry did not choose pair window", decision)
	}
	now = start.Add(15 * time.Minute)
	if decision, _ := l.CheckLogin(ip, "later@example.test"); decision.Allowed || decision.RetryAfter != 600 {
		t.Fatal("pair window reset with IP", decision)
	}
	if decision, _ := l.CheckLogin(ip, "another@example.test"); !decision.Allowed {
		t.Fatal("expired IP window remains blocked")
	}
}

func TestIPLimitAcrossEmails(t *testing.T) {
	l := NewAttemptLimiter(func() time.Time { return time.Unix(1792497600, 0) })
	ip := netip.MustParseAddr("192.0.2.1")
	for i := 0; i < 100; i++ {
		decision, err := l.CheckLogin(ip, fmt.Sprintf("user%d@example.test", i))
		if err != nil || !decision.Allowed {
			t.Fatal(i, decision, err)
		}
	}
	if decision, _ := l.CheckLogin(ip, "next@example.test"); decision.Allowed || decision.RetryAfter != 900 {
		t.Fatal("IP limit bypass", decision)
	}
}

func TestRegistrationLimit(t *testing.T) {
	now := time.Unix(1792497600, 0)
	start := now
	l := NewAttemptLimiter(func() time.Time { return now })
	ip := netip.MustParseAddr("192.0.2.1")
	for i := 0; i < 20; i++ {
		decision, err := l.CheckRegister(ip)
		if err != nil || !decision.Allowed {
			t.Fatal(i, decision, err)
		}
	}
	if decision, _ := l.CheckRegister(ip); decision.Allowed || decision.RetryAfter != 3600 {
		t.Fatal("registration limit", decision)
	}
	if decision, _ := l.CheckLogin(ip, "a@example.test"); !decision.Allowed {
		t.Fatal("register/login counters mixed")
	}
	now = start.Add(time.Hour - time.Nanosecond)
	if decision, _ := l.CheckRegister(ip); decision.Allowed || decision.RetryAfter != 1 {
		t.Fatal("registration rounding", decision)
	}
	now = start.Add(time.Hour)
	if decision, _ := l.CheckRegister(ip); !decision.Allowed {
		t.Fatal("registration window not expired")
	}
	if decision, _ := NewAttemptLimiter(nil).CheckRegister(ip); !decision.Allowed {
		t.Fatal("new process retained old counters")
	}
}

func TestCapacityDoesNotEvictLiveKeys(t *testing.T) {
	now := time.Unix(1792497600, 0)
	start := now
	l := NewAttemptLimiter(func() time.Time { return now })
	for i := 0; i < MaxAttemptKeys; i++ {
		ip := netip.AddrFrom4([4]byte{10, byte(i >> 8), byte(i), 1})
		if decision, err := l.CheckRegister(ip); err != nil || !decision.Allowed {
			t.Fatal(i, decision, err)
		}
	}
	newIP := netip.MustParseAddr("192.0.2.1")
	if decision, _ := l.CheckRegister(newIP); decision.Allowed || decision.RetryAfter != 3600 {
		t.Fatal("capacity was not enforced", decision)
	}
	if len(l.windows) != MaxAttemptKeys || len(l.expires) != MaxAttemptKeys {
		t.Fatal("capacity overflow or eviction")
	}
	// Existing keys still work and consume their allowance even when full.
	oldIP := netip.AddrFrom4([4]byte{10, 0, 0, 1})
	for i := 1; i < 20; i++ {
		if decision, _ := l.CheckRegister(oldIP); !decision.Allowed {
			t.Fatal("existing key evicted/rejected")
		}
	}
	if decision, _ := l.CheckRegister(oldIP); decision.Allowed {
		t.Fatal("existing key counter lost")
	}
	now = start.Add(time.Hour - time.Nanosecond)
	if decision, _ := l.CheckLogin(newIP, "a@example.test"); decision.Allowed || decision.RetryAfter != 1 {
		t.Fatal("capacity retry rounding", decision)
	}
	now = start.Add(time.Hour)
	if decision, _ := l.CheckRegister(newIP); !decision.Allowed {
		t.Fatal("expired entries not reclaimed")
	}
	if len(l.windows) != 1 || len(l.expires) != 1 {
		t.Fatal("expired emails/IPs retained")
	}
}

func TestCapacityAllocationIsAtomicAcrossLoginKeys(t *testing.T) {
	now := time.Unix(1792497600, 0)
	l := NewAttemptLimiter(func() time.Time { return now })
	l.capacity = 2
	ip := netip.MustParseAddr("192.0.2.1")
	if decision, _ := l.CheckRegister(ip); !decision.Allowed {
		t.Fatal(decision)
	}
	if decision, _ := l.CheckLogin(ip, "alice@example.test"); decision.Allowed || decision.RetryAfter != 3600 {
		t.Fatal(decision)
	}
	if len(l.windows) != 1 {
		t.Fatal("partial key allocation")
	}
}

func TestConcurrentAttempts(t *testing.T) {
	var nano atomic.Int64
	nano.Store(time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC).UnixNano())
	l := NewAttemptLimiter(func() time.Time { return time.Unix(0, nano.Load()) })
	ip := netip.MustParseAddr("192.0.2.1")
	var allowed atomic.Int32
	var wait sync.WaitGroup
	for i := 0; i < 200; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			decision, err := l.CheckLogin(ip, "a@example.test")
			if err != nil {
				t.Error(err)
			}
			if decision.Allowed {
				allowed.Add(1)
			}
		}()
	}
	wait.Wait()
	if allowed.Load() != 10 {
		t.Fatal("concurrent pair limit bypass", allowed.Load())
	}
	if decision, _ := l.CheckLogin(ip, "b@example.test"); decision.Allowed {
		t.Fatal("denied concurrent attempts not counted")
	}
}

func TestIPCanonicalizationAndInvalidInputs(t *testing.T) {
	l := NewAttemptLimiter(nil)
	for i := 0; i < 20; i++ {
		if decision, _ := l.CheckRegister(netip.MustParseAddr("192.0.2.1")); !decision.Allowed {
			t.Fatal(decision)
		}
	}
	if decision, _ := l.CheckRegister(netip.MustParseAddr("::ffff:192.0.2.1")); decision.Allowed {
		t.Fatal("IPv4-mapped IPv6 bypass")
	}
	for _, ip := range []netip.Addr{{}, netip.MustParseAddr("fe80::1%eth0")} {
		if _, err := l.CheckRegister(ip); err == nil {
			t.Fatal("invalid register IP accepted")
		}
		if _, err := l.CheckLogin(ip, "a@example.test"); err == nil {
			t.Fatal("invalid login IP accepted")
		}
	}
	if _, err := l.CheckLogin(netip.MustParseAddr("192.0.2.2"), "invalid"); err == nil {
		t.Fatal("invalid email accepted")
	}
}
