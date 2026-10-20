package migrations_test

import "strings"

type constraintCase struct {
	name, sql, code string
	args            []any
}

func constraintCases(x ids) []constraintCase {
	check := func(name, sql string, args ...any) constraintCase { return constraintCase{name, sql, "23514", args} }
	unique := func(name, sql string, args ...any) constraintCase { return constraintCase{name, sql, "23505", args} }
	foreign := func(name, sql string, args ...any) constraintCase { return constraintCase{name, sql, "23503", args} }
	valid := func(name, sql string, args ...any) constraintCase { return constraintCase{name, sql, "", args} }
	missing := "00000000-0000-4000-8000-000000000000"
	cases := []constraintCase{
		check("account role", `UPDATE accounts SET system_role='ORGANIZER' WHERE id=$1`, x.bob),
		check("account status independent", `UPDATE accounts SET status='PENDING' WHERE id=$1`, x.bob),
		check("account revision", `UPDATE accounts SET revision=0 WHERE id=$1`, x.bob),
		check("account blank name", `UPDATE accounts SET display_name='   ' WHERE id=$1`, x.bob),
		check("email lowercase", `UPDATE accounts SET email='BOB@example.test' WHERE id=$1`, x.bob),
		check("email spaces", `UPDATE accounts SET email=' bob@example.test' WHERE id=$1`, x.bob),
		check("email ASCII", `UPDATE accounts SET email='боб@example.test' WHERE id=$1`, x.bob),
		check("email separator", `UPDATE accounts SET email='a@@example.test' WHERE id=$1`, x.bob),
		unique("email unique", `UPDATE accounts SET email='alice@example.test' WHERE id=$1`, x.bob),
		valid("display names not unique", `UPDATE accounts SET display_name='Человек' WHERE id=$1`, x.bob),
		check("password not plaintext", `UPDATE accounts SET password_hash='plaintext' WHERE id=$1`, x.bob),
		check("block requires decision", `UPDATE accounts SET status='BLOCKED' WHERE id=$1`, x.bob),
		check("active clears block decision", `UPDATE accounts SET blocked_at=now(),blocked_by_account_id=$2 WHERE id=$1`, x.bob, x.admin),
		check("admin protected", `UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=$1 WHERE id=$1`, x.admin),
		foreign("block reviewer FK", `UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=$2 WHERE id=$1`, x.bob, missing),
		valid("user block", `UPDATE accounts SET status='BLOCKED',blocked_at=now(),blocked_by_account_id=$2,revision=revision+1 WHERE id=$1`, x.bob, x.admin),
		check("avatar preset cannot pending", `UPDATE account_avatars SET status='PENDING' WHERE account_id=$1`, x.alice),
		check("avatar preset no SVG", `UPDATE account_avatars SET svg='<svg/>' WHERE account_id=$1`, x.alice),
		check("avatar preset no moderation", `UPDATE account_avatars SET reviewed_at=now(),reviewed_by=$2 WHERE account_id=$1`, x.alice, x.admin),
		check("avatar preset ID format", `UPDATE account_avatars SET preset_id='https://external.test/a.svg' WHERE account_id=$1`, x.alice),
		check("avatar preset positive revision", `UPDATE account_avatars SET revision=0 WHERE account_id=$1`, x.alice),
		valid("removed manifest ID retained", `UPDATE account_avatars SET preset_id='retired-preset' WHERE account_id=$1`, x.alice),
		check("avatar NONE clears preset", `UPDATE account_avatars SET source='NONE',status='EMPTY' WHERE account_id=$1`, x.alice),
		valid("avatar reset keeps revision", `UPDATE account_avatars SET source='NONE',status='EMPTY',preset_id=NULL,revision=revision+1 WHERE account_id=$1`, x.alice),
		check("avatar negative revision", `UPDATE account_avatars SET revision=-1 WHERE account_id=$1`, x.alice),
		check("avatar CUSTOM needs SVG", `UPDATE account_avatars SET source='CUSTOM',status='PENDING',preset_id=NULL,uploaded_at=now() WHERE account_id=$1`, x.alice),
		valid("avatar pending custom", `UPDATE account_avatars SET source='CUSTOM',status='PENDING',preset_id=NULL,svg='<svg/>',uploaded_at=now() WHERE account_id=$1`, x.alice),
		check("avatar custom no preset", `UPDATE account_avatars SET source='CUSTOM',status='PENDING',svg='<svg/>',uploaded_at=now() WHERE account_id=$1`, x.alice),
		check("avatar custom approved needs reviewer", `UPDATE account_avatars SET source='CUSTOM',preset_id=NULL,svg='<svg/>',uploaded_at=now() WHERE account_id=$1`, x.alice),
		check("avatar custom pending no decision", `UPDATE account_avatars SET source='CUSTOM',status='PENDING',preset_id=NULL,svg='<svg/>',uploaded_at=now(),reviewed_at=now(),reviewed_by=$2 WHERE account_id=$1`, x.alice, x.admin),
		check("avatar custom cannot EMPTY", `UPDATE account_avatars SET source='CUSTOM',status='EMPTY',preset_id=NULL,svg='<svg/>',uploaded_at=now() WHERE account_id=$1`, x.alice),
		valid("avatar hidden custom", `UPDATE account_avatars SET source='CUSTOM',status='HIDDEN',preset_id=NULL,svg='<svg/>',uploaded_at=now(),reviewed_at=now(),reviewed_by=$2 WHERE account_id=$1`, x.alice, x.admin),
		check("session SHA256 length", `UPDATE sessions SET token_hash='bad' WHERE account_id=$1`, x.alice),
		check("session SHA256 canonical hex", `UPDATE sessions SET token_hash=$2 WHERE account_id=$1`, x.alice, strings.Repeat("A", 64)),
		check("session 24 hour lifetime", `UPDATE sessions SET expires_at=created_at+interval '25 hours' WHERE account_id=$1`, x.alice),
		check("session integer NumericDate", `UPDATE sessions SET created_at='2026-10-20 12:00:00.123+00',expires_at='2026-10-21 12:00:00.123+00' WHERE account_id=$1`, x.alice),
		unique("session token unique", `INSERT INTO sessions(account_id,token_hash,created_at,expires_at) SELECT $1,token_hash,created_at,expires_at FROM sessions WHERE account_id=$2`, x.bob, x.alice),
		check("organization refusal needs reason", `UPDATE organization_applications SET status='REJECTED' WHERE organization_id=$1`, x.organization),
		check("organization refusal blank reason", `UPDATE organization_applications SET status='REJECTED',rejection_reason='   ' WHERE organization_id=$1`, x.organization),
		valid("organization refusal with reason", `UPDATE organization_applications SET status='REJECTED',rejection_reason='Недостаточно сведений' WHERE organization_id=$1`, x.organization),
		check("organization approval no refusal", `UPDATE organization_applications SET rejection_reason='Причина' WHERE organization_id=$1`, x.organization),
		check("organization pending no decision", `UPDATE organization_applications SET status='PENDING' WHERE organization_id=$1`, x.organization),
		unique("one application per organization", `INSERT INTO organization_applications(organization_id) VALUES($1)`, x.organization),
		check("seed must be approved", `UPDATE activity_types SET catalog_status='PENDING' WHERE id=$1`, x.activity),
		check("seed has no creator", `UPDATE activity_types SET created_by_account_id=$2 WHERE id=$1`, x.activity, x.bob),
		check("custom activity needs creator", `UPDATE activity_types SET created_by_account_id=NULL WHERE name='Свой спорт'`),
		check("custom activity approval needs review", `UPDATE activity_types SET catalog_status='APPROVED' WHERE name='Свой спорт'`),
		check("activity refusal needs reason", `UPDATE activity_types SET catalog_status='REJECTED',reviewed_at=now(),reviewed_by_account_id=$1 WHERE name='Свой спорт'`, x.admin),
		valid("rejected activity remains usable", `UPDATE activity_types SET catalog_status='REJECTED',reviewed_at=now(),reviewed_by_account_id=$1,rejection_reason='Не включаем в общий список' WHERE name='Свой спорт'`, x.admin),
		unique("activity unique across states", `INSERT INTO activity_types(name,normalized_name,created_by_account_id) VALUES('Бег','бег',$1)`, x.bob),
		check("event organizer exactly one", `UPDATE events SET organization_id=$2 WHERE id=$1`, x.event, x.organization),
		check("event organizer required", `UPDATE events SET organizer_account_id=NULL WHERE id=$1`, x.event),
		check("personal author matches creator", `UPDATE events SET organizer_account_id=$2 WHERE id=$1`, x.event, x.bob),
		check("event publication independent", `UPDATE events SET publication_status='APPROVED' WHERE id=$1`, x.event),
		check("event join mode", `UPDATE events SET join_mode='WAITLIST' WHERE id=$1`, x.event),
		check("event unpublication needs reason", `UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=$2 WHERE id=$1`, x.event, x.admin),
		check("event unpublication blank reason", `UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=$2,unpublish_reason='   ' WHERE id=$1`, x.event, x.admin),
		valid("event unpublished with reason", `UPDATE events SET publication_status='UNPUBLISHED',unpublished_at=now(),unpublished_by=$2,unpublish_reason='Не подходит для публикации' WHERE id=$1`, x.event, x.admin),
		check("event published no unpublication", `UPDATE events SET unpublish_reason='Причина' WHERE id=$1`, x.event),
		valid("event conditions may be empty", `UPDATE events SET conditions='' WHERE id=$1`, x.event),
		check("event report revision", `UPDATE events SET reports_revision=-1 WHERE id=$1`, x.event),
		check("event finite start", `UPDATE events SET starts_at='infinity' WHERE id=$1`, x.event),
		foreign("event activity FK", `UPDATE events SET activity_type_id=$2 WHERE id=$1`, x.event, missing),
		unique("participation unique", `INSERT INTO participations(event_id,account_id,status) VALUES($1,$2,'PENDING')`, x.event, x.bob),
		check("participation rejection needs decision", `UPDATE participations SET status='REJECTED' WHERE event_id=$1 AND account_id=$2`, x.event, x.bob),
		check("participation pending no decision", `UPDATE participations SET status='PENDING',decided_by=$3,decided_at=now() WHERE event_id=$1 AND account_id=$2`, x.event, x.bob, x.alice),
		check("participation decision pair", `UPDATE participations SET decided_at=now() WHERE event_id=$1 AND account_id=$2`, x.event, x.bob),
		valid("participation accepted application", `UPDATE participations SET decided_by=$3,decided_at=now() WHERE event_id=$1 AND account_id=$2`, x.event, x.bob, x.alice),
		valid("participation rejected application", `UPDATE participations SET status='REJECTED',decided_by=$3,decided_at=now() WHERE event_id=$1 AND account_id=$2`, x.event, x.bob, x.alice),
		check("message hidden needs decision", `UPDATE messages SET status='HIDDEN' WHERE id=$1`, x.message),
		check("message hiding pair", `UPDATE messages SET status='HIDDEN',hidden_by=$2 WHERE id=$1`, x.message, x.admin),
		check("message restore requires hide history", `UPDATE messages SET restored_by=$2,restored_at=now() WHERE id=$1`, x.message, x.admin),
		check("visible hidden history needs restore", `UPDATE messages SET hidden_by=$2,hidden_at=now() WHERE id=$1`, x.message, x.admin),
		valid("message hidden", `UPDATE messages SET status='HIDDEN',hidden_by=$2,hidden_at=now(),moderation_revision=1 WHERE id=$1`, x.message, x.admin),
		valid("message restored with history", `UPDATE messages SET hidden_by=$2,hidden_at=now(),restored_by=$2,restored_at=now(),moderation_revision=2 WHERE id=$1`, x.message, x.admin),
		valid("message hidden again keeps restore history", `UPDATE messages SET status='HIDDEN',hidden_by=$2,hidden_at=now(),restored_by=$2,restored_at=now(),moderation_revision=3 WHERE id=$1`, x.message, x.admin),
		check("message revision nonnegative", `UPDATE messages SET moderation_revision=-1 WHERE id=$1`, x.message),
		check("message reports revision nonnegative", `UPDATE messages SET reports_revision=-1 WHERE id=$1`, x.message),
		check("message nonblank", `UPDATE messages SET body='  ' WHERE id=$1`, x.message),
		check("report exactly one target", `UPDATE reports SET target_event_id=$2 WHERE id=$1`, x.report, x.event),
		check("report target required", `UPDATE reports SET target_message_id=NULL WHERE id=$1`, x.report),
		check("report target type matches FK", `UPDATE reports SET target_type='EVENT' WHERE id=$1`, x.report),
		check("report close needs reviewer", `UPDATE reports SET status='RESOLVED' WHERE id=$1`, x.report),
		check("report OPEN no review", `UPDATE reports SET reviewed_by=$2,reviewed_at=now() WHERE id=$1`, x.report, x.admin),
		valid("report closed", `UPDATE reports SET status='RESOLVED',reviewed_by=$2,reviewed_at=now() WHERE id=$1`, x.report, x.admin),
		foreign("report real message FK", `UPDATE reports SET target_message_id=$2 WHERE id=$1`, x.report, missing),
		unique("report one per message lifetime", `INSERT INTO reports(reporter_account_id,target_type,target_message_id) VALUES($1,'MESSAGE',$2)`, x.alice, x.message),
		unique("closed event report still unique", `INSERT INTO reports(reporter_account_id,target_type,target_event_id) VALUES($1,'EVENT',$2)`, x.bob, x.orgEvent),
		foreign("no cascade event deletion", `DELETE FROM events WHERE id=$1`, x.event),
		foreign("no cascade account deletion", `DELETE FROM accounts WHERE id=$1`, x.bob),
		check("singleton ID only one", `INSERT INTO demo_state(id) VALUES(2)`),
		unique("singleton unique", `INSERT INTO demo_state(id) VALUES(1)`),
		check("receipt complete", `UPDATE demo_state SET last_reset_id=gen_random_uuid()`),
		check("receipt generation changed", `UPDATE demo_state SET last_reset_id=gen_random_uuid(),last_reset_from_generation=generation,last_reset_at=now(),last_reset_seed_version='test',last_reset_base_date=current_date`),
		valid("receipt atomic with new generation", `UPDATE demo_state SET generation=gen_random_uuid(),last_reset_id=gen_random_uuid(),last_reset_from_generation=generation,last_reset_at=now(),last_reset_seed_version='test',last_reset_base_date=current_date`),
	}
	for _, test := range []struct {
		name, body string
		valid      bool
	}{
		{"ASCII exact 128KiB", strings.Repeat("x", 131072), true},
		{"ASCII exceeds 128KiB", strings.Repeat("x", 131073), false},
		{"UTF8 exact 128KiB", strings.Repeat("я", 65536), true},
		{"UTF8 exceeds 128KiB", strings.Repeat("я", 65536) + "x", false},
	} {
		code := "23514"
		if test.valid {
			code = ""
		}
		cases = append(cases, constraintCase{"cover " + test.name, `UPDATE events SET cover_svg=$2 WHERE id=$1`, code, []any{x.event, test.body}})
		cases = append(cases, constraintCase{"avatar " + test.name, `UPDATE account_avatars SET source='CUSTOM',status='PENDING',preset_id=NULL,svg=$2,uploaded_at=now() WHERE account_id=$1`, code, []any{x.alice, test.body}})
	}
	return cases
}
