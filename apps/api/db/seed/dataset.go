package seed

import (
	"time"

	"github.com/LeonovProject/ryadom/apps/api/internal/platform/authn"
	"github.com/google/uuid"
)

// These are intentionally public, fictional demo credentials from DEC-20.
// The PHC hashes are generated fresh; no plaintext password is stored in the DB.
type account struct {
	id                                           uuid.UUID
	key, name, email, passwordHash, role, status string
}
type organization struct {
	id                        uuid.UUID
	key, name, status, reason string
}
type activity struct {
	id                        uuid.UUID
	key, name, status, reason string
	seeded                    bool
}
type event struct {
	id                                                                            uuid.UUID
	key, title, description, activity, owner, organization, joinMode, publication string
	starts                                                                        time.Time
	reportsRevision                                                               int
}
type participation struct {
	id                     uuid.UUID
	event, account, status string
	created                time.Time
	decided                bool
}
type message struct {
	id                               uuid.UUID
	key, event, author, body, status string
	revision, reportsRevision        int
	hidden, restored                 bool
}
type report struct {
	id                               uuid.UUID
	reporter, event, message, status string
}
type dataset struct {
	baseDate, presetID string
	now                time.Time
	accounts           []account
	organizations      []organization
	activities         []activity
	events             []event
	participations     []participation
	messages           []message
	reports            []report
}

func build(now time.Time, presetID string) (*dataset, error) {
	if now.IsZero() || now.Year() < 2000 || now.Year() > 9998 {
		return nil, ErrInvalidOptions
	}
	if presetID != "" && !presetIDPattern.MatchString(presetID) {
		return nil, ErrInvalidOptions
	}
	zone, err := time.LoadLocation("Asia/Krasnoyarsk")
	if err != nil {
		return nil, err
	}
	local := now.In(zone)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, zone)
	d := &dataset{baseDate: day.Format("2006-01-02"), now: now.UTC(), presetID: presetID}
	newID := func() (uuid.UUID, error) { return uuid.NewRandom() }
	for _, entry := range []struct{ key, name, password, role, status string }{
		{"alex", "Алексей", "Ryadom-Alex-2026!", "USER", "ACTIVE"},
		{"anna", "Анна", "Ryadom-Anna-2026!", "USER", "ACTIVE"},
		{"marina", "Марина", "Ryadom-Marina-2026!", "ADMIN", "ACTIVE"},
		{"blocked", "Борис", "Ryadom-Blocked-2026!", "USER", "BLOCKED"},
		{"ivan", "Иван", "Ryadom-Ivan-2026!", "USER", "ACTIVE"},
		{"dasha", "Дарья", "Ryadom-Dasha-2026!", "USER", "ACTIVE"},
	} {
		id, err := newID()
		if err != nil {
			return nil, err
		}
		hash, err := authn.HashPassword(entry.password)
		if err != nil {
			return nil, err
		}
		d.accounts = append(d.accounts, account{id: id, key: entry.key, name: entry.name, email: entry.key + "@example.test", passwordHash: hash, role: entry.role, status: entry.status})
	}
	for _, entry := range []organization{
		{key: "approved", name: "Клуб «Шаг рядом»", status: "APPROVED"},
		{key: "pending-accept", name: "Кружок «Дворовая команда»", status: "PENDING"},
		{key: "pending-reject", name: "Сообщество «Спортивный квартал»", status: "PENDING"},
		{key: "rejected", name: "Клуб «Первый старт»", status: "REJECTED", reason: "Уточните описание деятельности и спортивные интересы."},
		{key: "draft", name: "Сообщество «Утро во дворе»"},
	} {
		entry.id, err = newID()
		if err != nil {
			return nil, err
		}
		d.organizations = append(d.organizations, entry)
	}
	for _, entry := range []activity{
		{key: "run", name: "Бег", seeded: true, status: "APPROVED"},
		{key: "football", name: "Футбол", seeded: true, status: "APPROVED"},
		{key: "chess", name: "Шахматы", seeded: true, status: "APPROVED"},
		{key: "exercise", name: "Зарядка", seeded: true, status: "APPROVED"},
		{key: "pending-a", name: "Петанк", status: "PENDING"},
		{key: "pending-b", name: "Скандинавская ходьба", status: "PENDING"},
		{key: "rejected", name: "Дворовые эстафеты", status: "REJECTED", reason: "Уточните единое название направления для общего списка."},
	} {
		entry.id, err = newID()
		if err != nil {
			return nil, err
		}
		d.activities = append(d.activities, entry)
	}
	at := func(offset, hour int) time.Time {
		return day.AddDate(0, 0, offset).Add(time.Duration(hour) * time.Hour).UTC()
	}
	for _, entry := range []event{
		{key: "open", title: "Пробежка для знакомства", activity: "run", owner: "anna", starts: at(1, 18), joinMode: "OPEN", description: "Свободная запись. Можно прийти без опыта, темп спокойный.", reportsRevision: 2},
		{key: "approval", title: "Футбол во дворе", activity: "football", owner: "anna", organization: "approved", starts: at(2, 19), joinMode: "APPROVAL", description: "Подайте заявку. У автора есть две отдельные заявки для принятия и отказа."},
		{key: "moderation", title: "Шахматы в парке", activity: "chess", owner: "anna", starts: at(3, 18), joinMode: "OPEN", description: "Открытая встреча для обсуждения и проверки модерации.", reportsRevision: 1},
		{key: "blocked", title: "Зарядка у фонтана", activity: "exercise", owner: "blocked", starts: at(1, 10), joinMode: "OPEN", description: "Публикация сохранена. Аккаунт автора заблокирован; запись остальных открыта до начала."},
		{key: "near", title: "Ближайший подтверждённый план", activity: "run", owner: "anna", starts: at(1, 9), joinMode: "OPEN"},
		{key: "far", title: "Дальний подтверждённый план", activity: "chess", owner: "anna", starts: at(7, 18), joinMode: "APPROVAL"},
		{key: "tie-a", title: "Утренняя зарядка в парке", activity: "exercise", owner: "anna", starts: at(2, 10), joinMode: "OPEN"},
		{key: "tie-b", title: "Бег в то же время", activity: "run", owner: "anna", starts: at(2, 10), joinMode: "OPEN"},
		{key: "today", title: "Начавшаяся сегодня встреча", activity: "exercise", owner: "anna", starts: at(0, 0), joinMode: "OPEN"},
		{key: "yesterday", title: "Встреча, начавшаяся вчера", activity: "chess", owner: "anna", starts: at(-1, 18), joinMode: "OPEN"},
		{key: "pending-plan", title: "План ожидает решения автора", activity: "football", owner: "anna", starts: at(1, 12), joinMode: "APPROVAL"},
		{key: "rejected-plan", title: "Заявка на встречу отклонена", activity: "football", owner: "anna", starts: at(1, 13), joinMode: "APPROVAL"},
		{key: "unpublished", title: "Снятая встреча с сохранённой записью", activity: "run", owner: "anna", starts: at(1, 14), joinMode: "OPEN", publication: "UNPUBLISHED", reportsRevision: 2},
		{key: "pending-activity-a", title: "Знакомимся с петанком", activity: "pending-a", owner: "anna", starts: at(3, 12), joinMode: "OPEN"},
		{key: "pending-activity-b", title: "Прогулка с палками", activity: "pending-b", owner: "anna", starts: at(3, 13), joinMode: "OPEN"},
		{key: "rejected-activity", title: "Командные эстафеты во дворе", activity: "rejected", owner: "alex", starts: at(4, 12), joinMode: "OPEN"},
	} {
		entry.id, err = newID()
		if err != nil {
			return nil, err
		}
		if entry.publication == "" {
			entry.publication = "PUBLISHED"
		}
		if entry.description == "" {
			entry.description = "Вымышленная встреча для проверки состояния личных планов и разных спортивных направлений."
		}
		d.events = append(d.events, entry)
	}
	for _, entry := range []participation{
		{event: "open", account: "ivan", status: "CONFIRMED", created: now.AddDate(0, 0, -3)},
		{event: "approval", account: "ivan", status: "PENDING", created: now.AddDate(0, 0, -2)},
		{event: "approval", account: "dasha", status: "PENDING", created: now.AddDate(0, 0, -1)},
		{event: "blocked", account: "ivan", status: "CONFIRMED", created: now.AddDate(0, 0, -2)},
		{event: "near", account: "alex", status: "CONFIRMED", created: now.AddDate(0, 0, -20)},
		{event: "far", account: "alex", status: "CONFIRMED", created: now.AddDate(0, 0, -1), decided: true},
		{event: "tie-a", account: "alex", status: "CONFIRMED", created: now.AddDate(0, 0, -4)},
		{event: "tie-b", account: "alex", status: "CONFIRMED", created: now.AddDate(0, 0, -3)},
		{event: "today", account: "alex", status: "CONFIRMED", created: now.AddDate(0, 0, -5)},
		{event: "yesterday", account: "alex", status: "CONFIRMED", created: now.AddDate(0, 0, -6)},
		{event: "pending-plan", account: "alex", status: "PENDING", created: now.AddDate(0, 0, -2)},
		{event: "rejected-plan", account: "alex", status: "REJECTED", created: now.AddDate(0, 0, -2), decided: true},
		{event: "unpublished", account: "alex", status: "CONFIRMED", created: now.AddDate(0, 0, -3)},
	} {
		entry.id, err = newID()
		if err != nil {
			return nil, err
		}
		d.participations = append(d.participations, entry)
	}
	for _, entry := range []message{
		{key: "question", event: "approval", author: "ivan", body: "Мяч будет или принести свой?", status: "VISIBLE"},
		{key: "answer", event: "approval", author: "anna", body: "Мяч будет. Возьмите удобную обувь и воду.", status: "VISIBLE"},
		{key: "open-report", event: "moderation", author: "ivan", body: "Сообщение для отдельного разбора жалобы.", status: "VISIBLE", reportsRevision: 1},
		{key: "fresh", event: "moderation", author: "dasha", body: "Где именно встречаемся в парке?", status: "VISIBLE"},
		{key: "hidden", event: "moderation", author: "ivan", body: "Исходный текст скрытого демонстрационного сообщения.", status: "HIDDEN", hidden: true, revision: 1, reportsRevision: 2},
		{key: "restored", event: "moderation", author: "dasha", body: "Восстановленное сообщение с прежним автором и датой.", status: "VISIBLE", hidden: true, restored: true, revision: 2, reportsRevision: 2},
		{key: "dismissed", event: "moderation", author: "alex", body: "Сообщение после отклонённой жалобы остаётся видимым.", status: "VISIBLE", reportsRevision: 2},
	} {
		entry.id, err = newID()
		if err != nil {
			return nil, err
		}
		d.messages = append(d.messages, entry)
	}
	for _, entry := range []report{
		{reporter: "alex", event: "moderation", status: "OPEN"},
		{reporter: "alex", message: "open-report", status: "OPEN"},
		{reporter: "alex", message: "hidden", status: "RESOLVED"},
		{reporter: "ivan", message: "restored", status: "RESOLVED"},
		{reporter: "ivan", message: "dismissed", status: "DISMISSED"},
		{reporter: "ivan", event: "unpublished", status: "RESOLVED"},
		{reporter: "dasha", event: "open", status: "DISMISSED"},
	} {
		entry.id, err = newID()
		if err != nil {
			return nil, err
		}
		d.reports = append(d.reports, entry)
	}
	return d, nil
}
