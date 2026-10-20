package seed

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (d *dataset) insert(ctx context.Context, tx pgx.Tx) error {
	accounts := map[string]uuid.UUID{}
	organizations := map[string]uuid.UUID{}
	activities := map[string]uuid.UUID{}
	events := map[string]uuid.UUID{}
	messages := map[string]uuid.UUID{}
	created := d.now.AddDate(0, 0, -30)
	decisionAt := d.now.Add(-time.Hour)
	// ADMIN exists before any reviewer FK or blocked-user state is inserted.
	for _, a := range d.accounts {
		if a.role == "ADMIN" {
			accounts[a.key] = a.id
			if _, err := tx.Exec(ctx, `INSERT INTO accounts(id,demo_key,display_name,email,password_hash,system_role,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`, a.id, a.key, a.name, a.email, a.passwordHash, a.role, created); err != nil {
				return err
			}
		}
	}
	for _, a := range d.accounts {
		accounts[a.key] = a.id
		if a.role == "ADMIN" {
			continue
		}
		var blockedAt, blockedBy any
		revision := 1
		updated := created
		if a.status == "BLOCKED" {
			blockedAt = decisionAt
			blockedBy = accounts["marina"]
			revision = 2
			updated = decisionAt
		}
		if _, err := tx.Exec(ctx, `INSERT INTO accounts(id,demo_key,display_name,email,password_hash,system_role,status,revision,blocked_at,blocked_by_account_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, a.id, a.key, a.name, a.email, a.passwordHash, a.role, a.status, revision, blockedAt, blockedBy, created, updated); err != nil {
			return err
		}
	}
	for _, a := range d.accounts {
		source, status, revision := "NONE", "EMPTY", 0
		var preset any
		if d.presetID != "" {
			source, status, revision = "PRESET", "APPROVED", 1
			preset = d.presetID
		}
		if _, err := tx.Exec(ctx, `INSERT INTO account_avatars(account_id,source,preset_id,status,revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$6)`, a.id, source, preset, status, revision, created); err != nil {
			return err
		}
	}
	for _, o := range d.organizations {
		organizations[o.key] = o.id
		if _, err := tx.Exec(ctx, `INSERT INTO organizations(id,owner_account_id,name,description,sport_interests,created_at,updated_at) VALUES($1,$2,$3,'Вымышленное спортивное сообщество для самостоятельной проверки.','Бег, футбол, шахматы и зарядка.',$4,$4)`, o.id, accounts["anna"], o.name, created.Add(time.Hour)); err != nil {
			return err
		}
		if o.status == "" {
			continue
		}
		id, err := uuid.NewRandom()
		if err != nil {
			return err
		}
		var reviewer, reviewed, reason any
		updated := created.Add(2 * time.Hour)
		if o.status != "PENDING" {
			reviewer = accounts["marina"]
			reviewed = decisionAt
			updated = decisionAt
		}
		if o.reason != "" {
			reason = o.reason
		}
		if _, err := tx.Exec(ctx, `INSERT INTO organization_applications(id,organization_id,status,reviewed_by,reviewed_at,rejection_reason,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, o.id, o.status, reviewer, reviewed, reason, created.Add(2*time.Hour), updated); err != nil {
			return err
		}
	}
	for _, a := range d.activities {
		activities[a.key] = a.id
		var creator, reviewer, reviewed, reason any
		updated := created.Add(3 * time.Hour)
		if !a.seeded {
			creator = accounts["anna"]
		}
		if a.status == "REJECTED" {
			reviewer = accounts["marina"]
			reviewed = decisionAt
			reason = a.reason
			updated = decisionAt
		}
		if _, err := tx.Exec(ctx, `INSERT INTO activity_types(id,name,normalized_name,is_seeded,catalog_status,created_by_account_id,reviewed_by_account_id,reviewed_at,rejection_reason,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, a.id, a.name, strings.ToLower(a.name), a.seeded, a.status, creator, reviewer, reviewed, reason, created.Add(3*time.Hour), updated); err != nil {
			return err
		}
	}
	for _, e := range d.events {
		events[e.key] = e.id
		var person, org, unpublisher, unpublishedAt, reason any
		if e.organization == "" {
			person = accounts[e.owner]
		} else {
			org = organizations[e.organization]
		}
		updated := created.Add(4 * time.Hour)
		if e.publication == "UNPUBLISHED" {
			unpublisher = accounts["marina"]
			unpublishedAt = decisionAt
			reason = "Встреча снята для проверки недоступной публикации. Существующая запись сохранена."
			updated = decisionAt
		}
		if _, err := tx.Exec(ctx, `INSERT INTO events(id,created_by_account_id,organizer_account_id,organization_id,activity_type_id,title,description,starts_at,timezone,city,location_text,conditions,join_mode,publication_status,unpublished_by,unpublished_at,unpublish_reason,reports_revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Asia/Krasnoyarsk','Красноярск','Центральный парк, у главного входа.','Удобная одежда и вода.',$9,$10,$11,$12,$13,$14,$15,$16)`, e.id, accounts[e.owner], person, org, activities[e.activity], e.title, e.description, e.starts, e.joinMode, e.publication, unpublisher, unpublishedAt, reason, e.reportsRevision, created.Add(4*time.Hour), updated); err != nil {
			return err
		}
	}
	for _, p := range d.participations {
		var decider, decidedAt any
		updated := p.created
		if p.decided {
			decider = accounts["anna"]
			decidedAt = decisionAt
			updated = decisionAt
		}
		if _, err := tx.Exec(ctx, `INSERT INTO participations(id,event_id,account_id,status,decided_by,decided_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, p.id, events[p.event], accounts[p.account], p.status, decider, decidedAt, p.created, updated); err != nil {
			return err
		}
	}
	for index, m := range d.messages {
		messages[m.key] = m.id
		var hiddenBy, hiddenAt, restoredBy, restoredAt any
		messageCreated := d.now.Add(-12 * time.Hour).Add(time.Duration(index) * time.Minute)
		updated := messageCreated
		if m.hidden {
			hiddenBy = accounts["marina"]
			hiddenAt = d.now.Add(-3 * time.Hour)
			updated = d.now.Add(-3 * time.Hour)
		}
		if m.restored {
			restoredBy = accounts["marina"]
			restoredAt = d.now.Add(-2 * time.Hour)
			updated = d.now.Add(-2 * time.Hour)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO messages(id,event_id,author_account_id,body,status,hidden_by,hidden_at,restored_by,restored_at,moderation_revision,reports_revision,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, m.id, events[m.event], accounts[m.author], m.body, m.status, hiddenBy, hiddenAt, restoredBy, restoredAt, m.revision, m.reportsRevision, messageCreated, updated); err != nil {
			return err
		}
	}
	for _, r := range d.reports {
		var eventID, messageID, reviewer, reviewed any
		target := "EVENT"
		if r.message != "" {
			target = "MESSAGE"
			messageID = messages[r.message]
		} else {
			eventID = events[r.event]
		}
		reportCreated := d.now.Add(-5 * time.Hour)
		updated := reportCreated
		if r.status != "OPEN" {
			reviewer = accounts["marina"]
			reviewed = decisionAt
			updated = decisionAt
			if r.message == "hidden" || r.message == "restored" {
				reviewed = d.now.Add(-3 * time.Hour)
				updated = d.now.Add(-3 * time.Hour)
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO reports(id,reporter_account_id,target_type,target_event_id,target_message_id,status,reviewed_by,reviewed_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, r.id, accounts[r.reporter], target, eventID, messageID, r.status, reviewer, reviewed, reportCreated, updated); err != nil {
			return err
		}
	}
	return nil
}
