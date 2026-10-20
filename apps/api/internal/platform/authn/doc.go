// Package authn supplies password hashing, session-token cryptography and bounded
// attempt limits. A verified JWT does not authorize access: BE-02 must check the
// current account and sessions row under the transaction's actor lock.
package authn

import "time"

type Clock func() time.Time

func clockOrNow(clock Clock) Clock {
	if clock == nil {
		return time.Now
	}
	return clock
}
