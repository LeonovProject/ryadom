/* Local visual prototype. All mutations are in memory and reset on reload. */
(() => {
  'use strict';
  const initial = window.RYADOM_DEMO;
  const state = {
    data: JSON.parse(JSON.stringify(initial)), actor: null, preview: 'DEFAULT',
    step: 1, draft: {}, draftDirty: false, orgDraft: {}, questions: {}, catalogPath: '/events', filtersOpen: null, filterFocus: null,
  };
  const main = document.querySelector('#main');
  const modal = document.querySelector('#modal');
  let toastTimer, nextId = 0;
  const uniqueId = prefix => `${prefix}-${Date.now()}-${++nextId}`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const paths = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', back: '<path d="m14 6-6 6 6 6"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h1m6 0h1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m2-16a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.2"/>',
    filter: '<path d="M4 6h16M7 12h10m-7 6h4"/>', chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9.5 9.5 0 0 1 19 0Z"/><path d="M7 10h10m-10 4h7"/>',
    run: '<circle cx="15" cy="4" r="2"/><path d="m12 8 4 4 5-1M12 8l-4 5 5 3-3 6M12 8 7 8l-3 4m9 4 5 2 1 4"/>',
    tennis: '<ellipse cx="14.5" cy="8.5" rx="5" ry="7" transform="rotate(40 14.5 8.5)"/><path d="m11 14-8 8m2-6 3 3m4-14 7 6m-9-3 6 6"/>',
    chess: '<path d="M6 21h12l-2-4H8l-2 4Zm2-4 2-7H8V6h8v4h-2l2 7M8 6V3m4 3V2m4 4V3"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="m12 8 4 3-1 5H9l-1-5 4-3Zm0 0V3m4 8 5-2m-6 7 3 4m-9-4-3 4m2-9L3 9"/>',
    stretch: '<circle cx="12" cy="4" r="2"/><path d="M12 8v7m0-5L4 7m8 3 8-3m-8 8-5 7m5-7 5 7"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  const mark = '<svg class="brand-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M13 49 27 15m10 34 14-34" fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round"/></svg>';
  const logo = () => `<a class="brand" href="#/" aria-label="Рядом — главная">${mark}<span>рядом</span></a>`;
  const person = id => state.data.people[id] || {name:'Участник',initials:'У'};
  const avatar = (id, extra = '') => `<span class="avatar ${extra}" aria-hidden="true">${esc(person(id).initials)}</span>`;
  const orgById = id => state.data.organizations.find(org => org.id === id);
  const isAdmin = () => person(state.actor).systemRole === 'ADMIN';
  const isPublished = e => e.publication !== 'UNPUBLISHED';
  const orgAvatar = (large = false, id = 'temp') => `<span class="avatar organization ${large ? 'large' : ''}" aria-hidden="true">${esc(orgById(id)?.initials || 'О')}</span>`;
  const yearFormatter = new Intl.DateTimeFormat('en', {year:'numeric',timeZone:'Asia/Krasnoyarsk'});
  const visibleYear = value => yearFormatter.format(new Date(value))===yearFormatter.format(new Date()) ? undefined : 'numeric';
  const messageCount = count => `${count} ${count%100>=11&&count%100<=14?'сообщений':count%10===1?'сообщение':count%10>=2&&count%10<=4?'сообщения':'сообщений'}`;
  const date = event => new Intl.DateTimeFormat('ru-RU', {day:'numeric',month:'long',year:visibleYear(event.date),timeZone:'Asia/Krasnoyarsk'}).format(new Date(event.date));
  const time = event => new Intl.DateTimeFormat('ru-RU', {hour:'2-digit',minute:'2-digit',timeZone:'Asia/Krasnoyarsk'}).format(new Date(event.date));
  const fullDate = event => new Intl.DateTimeFormat('ru-RU', {weekday:'short',day:'numeric',month:'long',year:visibleYear(event.date),timeZone:'Asia/Krasnoyarsk'}).format(new Date(event.date));
  const getRoute = () => new URL(location.hash.startsWith('#/') ? location.hash.slice(1) : '/', 'http://prototype.local');
  const eventById = id => state.data.events.find(e => e.id === id);
  const ownerName = e => e.organization ? orgById(e.organization)?.name || 'Организация' : person(e.owner).name;
  const ownerLink = e => e.organization ? `#/organizations/${encodeURIComponent(e.organization)}` : `#/people/${encodeURIComponent(e.owner)}`;
  const confirmed = e => e.participants.filter(p => p.status === 'CONFIRMED');
  const ownParticipation = e => e.participants.find(p => p.user === state.actor);
  const badge = (text, tone = '', glyph = '') => `<span class="badge ${tone}">${glyph ? icon(glyph) : ''}${esc(text)}</span>`;
  const paragraphs = text => esc(text).split('\n\n').map(p => `<p>${p}</p>`).join('');
  const notify = text => {
    const el = document.querySelector('#toast'); el.textContent = text; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  };
  const go = path => {
    if(dirtyForm()&&path!==getRoute().pathname+getRoute().search){
      modal.innerHTML=`<div class="modal-top"><h2 id="modal-title">Выйти из создания?</h2><button class="icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div><p class="modal-note">Данные формы ещё не сохранены. При уходе заполнение будет потеряно.</p><div class="form-actions"><button class="btn secondary" data-action="close-modal">Остаться</button><button class="btn" data-action="leave-form" data-path="${esc(path)}">Выйти</button></div>`;
      modal.showModal();return;
    }
    if (getRoute().pathname + getRoute().search === path) render(); else location.hash = path;
  };
  const breadcrumb = (text, href = '#/events', backText = 'Все встречи') => `<nav class="breadcrumbs" aria-label="Навигационная цепочка"><a href="${esc(href)}">${icon('back')}${esc(backText)}</a><span>/</span><span>${esc(text)}</span></nav>`;
  const empty = (title, desc, action = '<a class="btn" href="#/events">Найти встречу</a>') => `<div class="empty">${icon('search')}<h2>${esc(title)}</h2><p>${esc(desc)}</p>${action}</div>`;
  const ART_BY_ICON = { run: 'stride', tennis: 'court', chess: 'chess', ball: 'volleyball', stretch: 'yoga', target: 'hike' };
  const ART_CHOICES = {
    run: [['stride', 'Маршрут'], ['stride-blue', 'Маршрут, синий'], ['stride-alt', 'Стадион']],
    tennis: [['court', 'Корт'], ['court-blue', 'Корт, синий'], ['court-alt', 'Розыгрыш']],
    chess: [['chess', 'Партия'], ['chess-red', 'Партия, красная'], ['chess-alt', 'Фигуры']],
    ball: [['volleyball', 'Волейбол']],
    stretch: [['yoga', 'Поза дерева'], ['yoga-red', 'Поза дерева, красная'], ['yoga-alt', 'Закат']],
    target: [['hike', 'Поход'], ['hike-alt', 'Лагерь'], ['hike-warm', 'Поход, тёплый'], ['bike', 'Велопрогулка'], ['bike-blue', 'Велопрогулка, синяя'], ['bike-alt', 'Велогонка'], ['swim', 'Бассейн'], ['swim-alt', 'Открытая вода'], ['swim-red', 'Бассейн, красный']],
  };
  const iconForSport = sport => ({Бег:'run',Теннис:'tennis',Шахматы:'chess',Волейбол:'ball',Зарядка:'stretch'})[sport] || 'target';
  const selectedArt = (icon, current) => (ART_CHOICES[icon] || ART_CHOICES.target).some(([file]) => file === current) ? current : ART_BY_ICON[icon] || 'hike';
  const ART_FILES = new Set(Object.values(ART_CHOICES).flat().map(([file]) => file));
  const artFor = e => ART_FILES.has(e.art) ? e.art : ART_BY_ICON[e.icon] || 'hike';
  function artwork(e, large = false) {
    return `<div class="event-art art-${esc(e.id)} ${large ? 'detail-art' : ''}" aria-hidden="true"><img src="assets/event-art/${artFor(e)}.svg" alt="" width="400" height="150" loading="${large ? 'eager' : 'lazy'}"><span class="art-type">${esc((e.sport || 'Спорт').toUpperCase())}</span></div>`;
  }
  function artPicker(icon, current) {
    const options = ART_CHOICES[icon] || ART_CHOICES.target;
    const selected = selectedArt(icon, current);
    return `<fieldset class="art-picker"><legend>Обложка встречи</legend><div class="art-options">${options.map(([file, label]) => `<label class="art-option"><input type="radio" name="art" value="${file}" ${selected === file ? 'checked' : ''}><img src="assets/event-art/${file}.svg" alt="" width="400" height="150"><span class="art-label">${esc(label)}</span><span class="art-selected" aria-hidden="true">✓</span></label>`).join('')}</div><small class="art-hint">Иллюстрация появится в карточке и на странице встречи. Выбор в макете сохраняется только до перезагрузки.</small></fieldset>`;
  }
  function eventCard(e) {
    return `<article class="event-card"><a href="#/events/${encodeURIComponent(e.id)}" aria-label="${esc(e.title)}">${artwork(e)}<div class="event-body"><h3>${esc(e.title)}</h3><div class="event-meta">${icon('calendar')}${esc(fullDate(e))} · ${esc(time(e))} · UTC+7</div><div class="event-meta">${icon('pin')}${esc(e.place)}</div><p class="tagline">${esc(e.tagline || 'В своём темпе, вместе с другими')}</p></div></a><div class="event-bottom"><a class="owner-label" href="${ownerLink(e)}">${e.organization ? orgAvatar(false,e.organization) : avatar(e.owner, 'warm')}<span>${esc(e.organization ? ownerName(e) : person(e.owner).name.split(' ')[0])}</span></a><span class="mode-label">${icon(e.mode === 'OPEN' ? 'check' : 'clock')}${e.mode === 'OPEN' ? 'Свободная запись' : 'По заявке'}</span></div></article>`;
  }
  function renderChrome(route) {
    const isEvent = /^\/events\/[^/]+$/.test(route.pathname) && route.pathname !== '/events/new';
    const screens = [['/','Главная'],['/events','Каталог'],['/orgs','Подбор организаций'],['/events/run','Мероприятие'],['/people/anna','Профиль человека'],['/organizations/temp','Публичная организация'],['/login','Вход'],['/register','Регистрация'],['/me','Мой профиль'],['/me/events','Мои встречи'],['/events/new','Создание встречи'],['/events/tennis/manage','Участники и заявки'],['/me/organizations','Мои организации'],['/organizations/new','Создание организации'],['/me/organizations/rook','Кабинет организации'],['/admin/organizations','Поиск организаций'],['/admin/organizations/rook','Допуск организации'],['/admin/events','Поиск встреч'],['/admin/events/tennis','Модерация встречи']];
    const selection = isEvent ? '/events/run' : route.pathname;
    if(!screens.some(([path])=>path===selection))screens.push([selection,'Текущий экран']);
    document.querySelector('#prototype-bar').innerHTML = `<div class="prototype-bar"><div class="container prototype-inner"><span class="prototype-caption"><i class="proto-dot"></i><strong>ДИЗАЙН 03</strong><span class="prototype-long">Данные вымышлены · изменения до перезагрузки</span><span class="prototype-short">/ РЯДОМ</span></span><div class="prototype-controls"><label><span>Экран</span><select aria-label="Экран прототипа" data-action="screen">${screens.map(([path,title])=>`<option value="${path}" ${selection === path ? 'selected' : ''}>${title}</option>`).join('')}</select></label>${isEvent ? `<label><span>Состояние</span><select aria-label="Состояние встречи" data-action="preview">${[['DEFAULT','Обычное'],['PENDING','Заявка отправлена'],['CONFIRMED','Ты участвуешь'],['REJECTED','Заявка отклонена'],['UNPUBLISHED','Публикация снята'],['ERROR','Ошибка загрузки'],['LOADING','Загрузка']].map(([id,label])=>`<option value="${id}" ${state.preview === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>` : ''}<button class="proto-reset" data-action="reset">Сбросить</button></div></div></div>`;
    document.querySelector('#site-header').innerHTML = `<div class="container"><header class="site-header">${logo()}<nav class="header-nav" aria-label="Основная навигация"><a href="#/events" class="${route.pathname.startsWith('/events') ? 'active' : ''}">Встречи</a><a href="#/orgs" class="${route.pathname.startsWith('/orgs') ? 'active' : ''}">Организации</a>${state.actor?'<a href="#/me/organizations">Мои организации</a>':''}${isAdmin()?'<a href="#/admin/organizations">Модерация</a>':''}</nav><div class="header-right"><a class="text-link create-header" href="#/events/new">${icon('plus')}Создать встречу</a>${state.actor ? `<a href="#/me" aria-label="Личный кабинет: ${esc(person(state.actor).name)}">${avatar(state.actor,'warm')}</a>` : '<button class="btn secondary" data-action="login">Войти</button>'}</div></header></div>`;
    document.querySelector('#site-footer').innerHTML = `<footer class="site-footer"><div class="container footer-inner">${logo()}<span>Есть планы. Будет компания.</span><p class="footer-note">Дизайн-прототип · версия 0.3<br>Профили, сообщества и встречи вымышлены.</p></div></footer>`;
    document.querySelector('#mobile-nav').innerHTML = `<nav class="mobile-nav" aria-label="Мобильная навигация"><a href="#/events" class="${route.pathname.startsWith('/events') ? 'active' : ''}">${icon('search')}Встречи</a><a href="#/me/events" class="${route.pathname === '/me/events' ? 'active' : ''}">${icon('calendar')}Мои встречи</a><a href="#/me" class="${route.pathname === '/me' ? 'active' : ''}">${icon('user')}Профиль</a></nav>`;
  }
  function searchForm(query = '', city = 'Красноярск') {
    return `<form class="search-box" data-form="search"><label class="search-field">${icon('search')}<div><span>Что хочется делать?</span><input type="search" name="q" aria-label="Название или интерес" placeholder="Бег, теннис, шахматы…" value="${esc(query)}"></div></label><label class="search-field">${icon('pin')}<div><span>Где встречаемся?</span><input name="city" aria-label="Город" placeholder="Город" value="${esc(city)}"></div></label><button class="btn" type="submit">Найти встречу ${icon('arrow')}</button></form>`;
  }
  function home() {
    const upcoming=state.data.events.filter(e=>isPublished(e)&&new Date(e.date)>new Date()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,3);
    const heroArt = `<div class="hero-art"><div class="art-caption">В СВОЁМ ТЕМПЕ<span>Но с хорошей компанией</span></div><svg viewBox="0 0 500 354" aria-hidden="true"><g fill="none" stroke="#fff" opacity=".2"><circle cx="345" cy="130" r="145"/><circle cx="345" cy="130" r="108"/><circle cx="345" cy="130" r="72"/></g><g fill="none" stroke="#fff" stroke-width="38" stroke-linecap="round"><path d="m153 231 63-154m31 154 63-154"/></g><circle cx="352" cy="232" r="10" fill="#17191D"/><circle cx="369" cy="210" r="5" fill="#fff"/><path d="M44 248c88-1 98-78 160-74s71 78 139 58" fill="none" stroke="#fff" stroke-dasharray="3 7" stroke-linecap="round"/></svg><div class="art-note"><span class="art-note-icon">${icon('run')}</span><div><strong>Бежим вдоль Енисея</strong><small>Суббота, 24 октября · 09:00</small></div>${icon('arrow')}</div></div>`;
    return `<div class="container"><section class="hero"><div><p class="eyebrow">Совместные занятия и встречи</p><h1>Есть планы.<br>Найдётся<br><span class="red">компания.</span></h1><p class="hero-description">Пробежка у реки, партия в шахматы или первая подача. Найди людей, с которыми захочется начать.</p><div class="hero-actions"><a class="btn" href="#/events">Выбрать встречу ${icon('arrow')}</a><a class="text-link" href="#/events/new">Или создать свою ${icon('plus')}</a></div></div>${heroArt}</section>${searchForm()}<nav class="category-row" aria-label="Спортивные направления">${[['run','Бег'],['tennis','Теннис'],['chess','Шахматы'],['ball','Волейбол'],['stretch','Зарядка']].map(([glyph,sport])=>`<a class="chip" href="#/events?sport=${encodeURIComponent(sport)}">${icon(glyph)}${sport}</a>`).join('')}</nav><section class="section"><div class="section-head"><div><h2>Ближайшие встречи</h2><p>Разные занятия. Один повод собраться.</p></div><a class="text-link" href="#/events">Все встречи ${icon('arrow')}</a></div><div class="event-grid">${upcoming.length?upcoming.map(eventCard).join(''):empty('Пока нет ближайших встреч','Можно посмотреть каталог или создать свою встречу.')}</div></section><section class="steps-section"><p class="eyebrow red">От желания — к встрече</p><div class="how-grid">${[['01','Найди своё','Выбери занятие, время и место, которые тебе подходят.'],['02','Договорись','Посмотри условия или задай организатору вопрос.'],['03','Встречайтесь','Присоединяйся сразу или дождись подтверждения заявки.']].map(([n,title,body])=>`<div class="how-item"><span class="step-number">${n}</span><div><h3>${title}</h3><p>${body}</p></div></div>`).join('')}</div></section><section class="community-invite"><div><h2>Уже собираете людей?</h2><p>Создайте профиль клуба или сообщества. После допуска можно публиковать встречи от его имени.</p></div><a class="btn secondary" href="#/organizations/new">Создать профиль организации ${icon('arrow')}</a></section></div>`;
  }
  function catalog(route) {
    state.catalogPath=route.pathname+route.search;
    const q=route.searchParams.get('q')||'', city=route.searchParams.get('city')||'', sport=route.searchParams.get('sport')||'', mode=route.searchParams.get('mode')||'', day=route.searchParams.get('day')||'';
    const events=state.data.events.filter(e=>isPublished(e)&&(!q || `${e.title} ${e.sport} ${e.description}`.toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru')))&&(!city||e.city.toLocaleLowerCase('ru')===city.toLocaleLowerCase('ru').trim())&&(!sport||sport===e.sport)&&(!mode||mode===e.mode)&&(!day||e.date.slice(0,10)===day)).sort((a,b)=>a.date.localeCompare(b.date));
    const sportOptions=[...new Set(state.data.events.map(e=>e.sport))];
    const selected=[sport,mode==='OPEN'?'Свободная запись':mode==='APPROVAL'?'По заявке':'',day].filter(Boolean);
    return `<div class="container page"><div class="page-intro"><div><p class="eyebrow red form-eyebrow">Встречаемся рядом</p><h1>Найди свои планы</h1><p>Выбери занятие — компания уже собирается.</p></div><a class="btn secondary" href="#/events/new">${icon('plus')}Создать встречу</a></div><p class="catalog-org-link"><a class="text-link" href="#/orgs">Организации и сообщества ${icon('arrow')}</a></p><div class="catalog-search">${searchForm(q,city)}</div><div class="catalog-layout"><details class="filter-panel" ${(state.filtersOpen??innerWidth>=768)?'open':''}><summary>${icon('filter')}Фильтры ${[sport,mode,day].filter(Boolean).length ? `· ${[sport,mode,day].filter(Boolean).length}`:''}</summary><form class="filter-content" data-form="filters"><div class="filter-group"><h3>Направление</h3><label><input type="radio" name="sport" value="" ${!sport?'checked':''}>Все направления</label>${sportOptions.map(s=>`<label><input type="radio" name="sport" value="${esc(s)}" ${sport===s?'checked':''}>${esc(s)}</label>`).join('')}</div><div class="filter-group"><h3>Как присоединиться</h3><label><input type="radio" name="mode" value="" ${!mode?'checked':''}>Любой способ</label><label><input type="radio" name="mode" value="OPEN" ${mode==='OPEN'?'checked':''}>Свободно</label><label><input type="radio" name="mode" value="APPROVAL" ${mode==='APPROVAL'?'checked':''}>По заявке</label></div><div class="filter-group"><h3><label for="date-filter">Дата встречи</label></h3><input type="date" name="day" id="date-filter" value="${esc(day)}"></div><button class="btn subtle wide" type="button" data-action="clear-filters">Сбросить фильтры</button></form></details><div><div class="result-line" role="status"><span>Найдено встреч: ${events.length}</span><span>По дате начала</span></div>${selected.length?`<div class="active-filters" aria-label="Выбранные фильтры">${selected.map(label=>badge(label)).join('')}<button class="text-link" data-action="clear-filters">Сбросить</button></div>`:''}${events.length?`<div class="event-grid">${events.map(eventCard).join('')}</div>`:empty('Пока ничего не нашлось','Попробуй другое направление, город или дату. Или создай свою встречу.','<button class="btn" data-action="clear-filters">Сбросить поиск</button>')}</div></div></div>`;
  }
  function eventPage(e) {
    if(!isPublished(e)) return unavailableEvent(e);
    if (state.preview==='LOADING') return `<div class="container page">${breadcrumb('Встреча','#'+state.catalogPath,'К результатам')}<div role="status" aria-label="Загружаем встречу"><div class="skeleton title"></div><div class="skeleton line"></div><div class="skeleton block"></div><div class="skeleton line"></div><p class="muted small">Загружаем встречу…</p></div></div>`;
    if (state.preview==='ERROR') return `<div class="container page">${breadcrumb('Встреча','#'+state.catalogPath,'К результатам')}${empty('Не удалось загрузить встречу','Проверь соединение и попробуй ещё раз.','<button class="btn" data-action="retry">Попробовать снова</button>')}</div>`;
    if (state.preview==='UNPUBLISHED') return unavailableEvent(e,true);
    const own=state.actor===e.owner, status=state.preview!=='DEFAULT'?state.preview:ownParticipation(e)?.status;
    const title=status==='CONFIRMED'?'Ты участвуешь':status==='PENDING'?'Заявка отправлена':status==='REJECTED'?'Заявка отклонена':e.mode==='OPEN'?'Присоединяйся':'Встреча по заявке';
    const statusText=status==='CONFIRMED'?'До встречи! Всё о времени и месте — ниже.':status==='PENDING'?'Ожидаем решение организатора. Пока участие не подтверждено.':status==='REJECTED'?'В этот раз участие не подтверждено. Можно выбрать другую встречу.':e.mode==='OPEN'?'Запись сразу подтверждается. Отдельного одобрения не нужно.':'Организатор рассмотрит заявку и подтвердит участие.';
    const noticeTone=status==='CONFIRMED'?'success':status==='PENDING'?'info':status==='REJECTED'?'error':'';
    return `<div class="container page">${breadcrumb(e.title,'#'+state.catalogPath,'К результатам')}<div class="event-heading">${badge(e.sport,'',e.icon)}<h1 class="detail-title">${esc(e.title)}</h1><div class="detail-info"><span>${icon('calendar')}${esc(fullDate(e))} · ${time(e)}</span><span>${icon('pin')}${esc(e.city)}, ${esc(e.place)}</span></div></div><div class="detail-layout"><div class="detail-content">${artwork(e,true)}<section class="detail-section"><h2>О встрече</h2>${paragraphs(e.description)}</section><section class="detail-section"><h2>Что нужно знать</h2><div class="info-line">${icon('check')}<p>${esc(e.conditions)}</p></div></section><section class="detail-section"><h2>Где встречаемся</h2><div class="info-line">${icon('pin')}<div><p><strong>${esc(e.place)}</strong></p><p class="muted">${esc(e.meetingPoint)}</p></div></div></section><section class="detail-section" id="discussion"><div class="section-head"><h2>Обсуждение</h2><span class="muted small">${messageCount(e.messages.length)}</span></div><p class="muted">Хочешь уточнить условия? Вопрос можно задать и до записи.</p>${discussionMessages(e)}<form class="question-form" data-form="question" data-event="${e.id}"><label class="field"><span>Твой вопрос</span><textarea name="body" maxlength="4000" required placeholder="Например, можно ли прийти без опыта?">${esc(state.questions[e.id]||'')}</textarea></label><div class="question-actions"><p class="small muted">${state.actor?'Пиши по делу и уважай других участников.':'Войди, чтобы отправить вопрос организатору.'}</p><button class="btn" type="submit">${state.actor?'Задать вопрос':'Войти и задать вопрос'} ${icon('arrow')}</button></div></form></section></div><aside class="join-panel" aria-label="Участие во встрече">${isAdmin()?`<a class="text-link" href="#/admin/events/${e.id}">К модерации ${icon('arrow')}</a>`:''}${badge(e.mode==='OPEN'?'Свободная запись':'По заявке',e.mode==='APPROVAL'?'info':'',e.mode==='OPEN'?'check':'clock')}<h2>${own?'Ты организуешь эту встречу':title}</h2><p class="small muted">${own?'Состав и заявки участников доступны в управлении встречей.':statusText}</p>${own?`<a class="btn wide" href="#/events/${e.id}/manage">Участники и заявки</a>`:status?`<div class="notice ${noticeTone}" style="margin-top:18px">${icon(status==='CONFIRMED'?'check':status==='PENDING'?'clock':'info')}<span>${status==='CONFIRMED'?'Участие подтверждено':status==='PENDING'?'Ожидает решения':'Участие не подтверждено'}</span></div>${status==='REJECTED'?'<a class="text-link" href="#/events">Другие встречи '+icon('arrow')+'</a>':`<a class="text-link" href="#/me/events?tab=${status==='PENDING'?'pending':'confirmed'}">${status==='PENDING'?'Мои заявки':'Мои встречи'} ${icon('arrow')}</a>`}`:`<button class="btn wide" data-action="join" data-id="${e.id}">${e.mode==='OPEN'?'Присоединиться':'Подать заявку'} ${icon('arrow')}</button>`}<div class="people-line"><div class="avatar-stack">${confirmed(e).slice(0,3).map(p=>avatar(p.user,'warm')).join('')}</div><span>${confirmed(e).length} в составе участников</span></div><div class="join-divider"></div><p class="date-big">${esc(date(e))}</p><p class="time">${time(e)} · Красноярск, UTC+7</p><p class="small">${esc(e.place)}</p><div class="join-divider"></div><p class="eyebrow muted" style="font-size:9px;margin-bottom:13px">Организатор</p><a class="organizer-mini" href="${ownerLink(e)}">${e.organization?orgAvatar(false,e.organization):avatar(e.owner,'warm')}<span><strong>${esc(ownerName(e))}</strong><span class="muted small">${e.organization?'Спортивное сообщество':'Участник Рядом'}</span></span>${icon('arrow')}</a></aside></div></div>`;
  }
  function profile(id) {
    const p=person(id), events=state.data.events.filter(e=>e.owner===id&&!e.organization&&isPublished(e));
    const sports=[...new Set(events.map(e=>e.sport))];
    return `<div class="container page">${breadcrumb(p.name)}<div class="profile-cover" aria-hidden="true"></div><section class="profile-header">${avatar(id,'large warm')}<div class="profile-info"><h1>${esc(p.name)}</h1><p class="small muted">Участник Рядом</p></div>${state.actor===id?'<a class="btn secondary" href="#/me">Мой кабинет</a>':''}</section><div class="profile-content"><aside class="profile-aside"><h2>Встречаемся за занятием</h2><p>Открой встречу, чтобы узнать условия и познакомиться с организатором в обсуждении.</p>${sports.length?`<h2 class="aside-heading">Направления встреч</h2><div class="interest-list">${sports.map(sport=>`<a class="chip" href="#/events?sport=${encodeURIComponent(sport)}">${esc(sport)}</a>`).join('')}</div>`:''}</aside><div><div class="section-head"><h2>Организует встречи</h2></div>${events.length?`<div class="event-grid">${events.map(eventCard).join('')}</div>`:empty('Встреч пока нет','Опубликованные личные встречи появятся здесь.')}</div></div></div>`;
  }
  function authPrompt(title, text) {
    const target=encodeURIComponent(getRoute().pathname+getRoute().search);
    return `<div class="container page">${breadcrumb(title)}<h1 class="gate-title">${esc(title)}</h1>${empty('Нужен демопрофиль',text,`<a class="btn" href="#/login?returnTo=${target}">Войти или зарегистрироваться ${icon('arrow')}</a>`)}</div>`;
  }
  function createPage() {
    if(!state.actor) return authPrompt('Соберём компанию?','Войди, чтобы создать встречу от своего имени.');
    if(!state.draftDirty&&state.step===1)state.draft.organizer=getRoute().searchParams.get('organization')||'personal';
    const d=state.draft, organization=d.organizer&&d.organizer!=='personal'?orgById(d.organizer):null;
    if(d.organizer!=='personal'&&(!organization||organization.owner!==state.actor))return deniedPage();
    if(organization&&organization.status!=='APPROVED')return `<div class="container page"><h1>Публикация пока недоступна</h1><section class="workspace-card"><p>Организация «${esc(organization.name)}» ещё не получила допуск.</p>${orgBadge(organization)}<div class="workspace-actions"><a class="btn secondary" href="#/me/organizations/${organization.id}">Кабинет организации</a><a class="text-link" href="#/events/new">Создать от себя</a></div></section></div>`;
    const val=(name,fallback='')=>esc(d[name]??fallback);
    let body;
    if(state.step===1) body=`<label class="field"><span>Кто организует</span><select class="control" name="organizer"><option value="personal" ${d.organizer==='personal'?'selected':''}>Я, ${esc(person(state.actor).name)}</option>${state.data.organizations.filter(org=>org.owner===state.actor).map(org=>`<option value="${org.id}" ${d.organizer===org.id?'selected':''} ${org.status!=='APPROVED'?'disabled':''}>${esc(org.name)} · ${org.status==='APPROVED'?'допущена':'нет допуска'}</option>`).join('')}</select></label><label class="field"><span>Название встречи</span><input name="title" value="${val('title')}" required maxlength="160" placeholder="Например, бежим вдоль реки"><small>Пусть по названию будет понятно, что вы собираетесь делать.</small></label><div class="field-grid"><label class="field"><span>Направление</span><select class="control" name="sport" data-action="draft-sport" required><option value="">Выбери направление</option>${[...new Set(state.data.events.map(e=>e.sport))].map(s=>`<option ${d.sport===s?'selected':''}>${esc(s)}</option>`).join('')}<option value="custom" ${d.sport==='custom'?'selected':''}>Своё направление</option></select></label>${d.sport==='custom'?`<label class="field"><span>Своё направление</span><input name="customSport" value="${val('customSport')}" maxlength="100" required placeholder="Например, фрисби"></label>`:''}</div><label class="field"><span>О встрече</span><textarea name="description" required maxlength="10000" placeholder="Что будете делать, какой темп и кому подойдёт встреча">${val('description')}</textarea></label><div class="field-grid"><label class="field"><span>Дата</span><input type="date" name="date" required value="${val('date')}" min="${new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Krasnoyarsk'}).format(new Date())}" max="${new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Krasnoyarsk'}).format(new Date(Date.now()+366*24*60*60*1000))}"></label><label class="field"><span>Время начала</span><input type="time" name="time" value="${val('time','10:00')}" required><small>Красноярск · UTC+7</small></label></div><label class="field"><span>Город</span><input name="city" required maxlength="120" value="${val('city','Красноярск')}"></label><label class="field"><span>Место встречи</span><input name="place" required maxlength="1000" value="${val('place')}" placeholder="Адрес или понятный ориентир"></label>`;
    else if(state.step===2) body=`<h2 style="font-size:24px;margin-bottom:22px">Как можно присоединиться?</h2><label class="radio-card"><input type="radio" name="mode" value="OPEN" ${d.mode!=='APPROVAL'?'checked':''}><div><strong>Свободная запись</strong><p>Человек сразу становится участником. Не нужно отдельно рассматривать каждую заявку.</p></div></label><label class="radio-card"><input type="radio" name="mode" value="APPROVAL" ${d.mode==='APPROVAL'?'checked':''}><div><strong>По заявке</strong><p>Ты принимаешь или отклоняешь заявки. До решения участие не подтверждено.</p></div></label>${artPicker(draftEvent().icon, d.art)}<label class="field" style="margin-top:28px"><span>Условия участия</span><textarea name="conditions" maxlength="4000" placeholder="Подготовка, одежда или инвентарь. Можно оставить пустым.">${val('conditions')}</textarea><small>Помоги человеку понять, подходит ли ему встреча.</small></label>`;
    else {
      const e=draftEvent();
      body=`<div class="notice neutral" style="margin-bottom:24px">${icon('info')}<div><strong>Всё выглядит правильно?</strong>После публикации встреча появится в каталоге этого макета.</div></div><div class="preview-summary">${artwork(e)}<div><h2>${esc(e.title)}</h2><dl><dt>Организатор</dt><dd>${esc(ownerName(e))}</dd><dt>Когда</dt><dd>${esc(fullDate(e))}, ${time(e)} · UTC+7</dd><dt>Где</dt><dd>${esc(e.city)}, ${esc(e.place)}</dd><dt>Запись</dt><dd>${e.mode==='OPEN'?'Свободная':'По заявке'}</dd><dt>О встрече</dt><dd>${esc(e.description)}</dd><dt>Условия</dt><dd>${esc(e.conditions)}</dd></dl></div></div>`;
    }
    return `<div class="form-page">${breadcrumb('Создать встречу')}<p class="eyebrow red form-eyebrow">Твой повод собраться</p><h1>Новая встреча</h1><p class="form-description">Расскажи о плане. Остальное начнётся со знакомства.</p><div class="wizard-steps" aria-label="Шаги создания">${['О встрече','Участие','Проверка'].map((name,i)=>`<div class="wizard-step ${state.step===i+1?'active':state.step>i+1?'done':''}" ${state.step===i+1?'aria-current="step"':''}><span>${state.step>i+1?'✓':i+1}</span>${name}</div>`).join('')}</div><form data-form="create">${body}<div class="form-actions">${state.step>1?'<button class="btn secondary" type="button" data-action="step-back">Назад</button>':'<span class="small muted">Шаг 1 из 3</span>'}<button class="btn" type="submit">${state.step===3?'Опубликовать встречу':'Продолжить'} ${icon('arrow')}</button></div></form><p class="preview-only">Дизайн-прототип: встреча сохранится только до перезагрузки страницы.</p></div>`;
  }
  function draftEvent() {
    const d=state.draft, sport=d.sport==='custom'?d.customSport:d.sport, eventIcon=iconForSport(sport);
    return {id:'new',title:d.title,sport,icon:eventIcon,art:selectedArt(eventIcon,d.art),date:`${d.date}T${d.time}:00+07:00`,city:d.city,place:d.place,meetingPoint:d.place,description:d.description,conditions:d.conditions?.trim()||'Дополнительных требований нет.',mode:d.mode||'OPEN',owner:state.actor,organization:d.organizer&&d.organizer!=='personal'?d.organizer:null,publication:'PUBLISHED',participants:[],messages:[],tagline:'Новый повод встретиться'};
  }
  function myPage(route) {
    if(!state.actor) return authPrompt('Твои встречи — здесь','Войди, чтобы увидеть участие, заявки и собственные встречи.');
    if(route.pathname==='/me') return `<div class="container page">${breadcrumb('Профиль')}<div class="profile-header" style="margin:20px 0 35px">${avatar(state.actor,'large warm')}<div class="profile-info" style="padding-top:0"><p class="eyebrow muted">Твой профиль</p><h1>${esc(person(state.actor).name)}</h1><a class="text-link" href="#/people/${state.actor}">Публичный профиль ${icon('arrow')}</a></div></div><div class="community-invite"><div><h2>Какие планы?</h2><p>Твои участия, заявки и собственные встречи в одном месте.</p></div><a class="btn" href="#/me/events">Мои встречи ${icon('arrow')}</a></div><div class="section-head"><h2>Собери свою компанию</h2><a class="btn secondary" href="#/events/new">${icon('plus')}Создать встречу</a></div><div class="workspace-actions"><a class="btn secondary" href="#/me/organizations">Мои организации ${icon('arrow')}</a><a class="text-link" href="#/organizations/new">Создать организацию</a>${isAdmin()?'<a class="btn secondary" href="#/admin/organizations">Допуск и модерация '+icon('arrow')+'</a>':''}<button class="text-link" data-action="login">Сменить демопрофиль</button></div><div><button class="text-link" style="background:none;color:var(--muted)" data-action="logout">Выйти из демопрофиля</button></div></div>`;
    const tab=route.searchParams.get('tab')||'confirmed';
    const events=state.data.events.filter(e=>tab==='created'?e.owner===state.actor&&!e.organization:tab==='pending'?['PENDING','REJECTED'].includes(ownParticipation(e)?.status):ownParticipation(e)?.status==='CONFIRMED');
    return `<div class="container page">${breadcrumb('Мои встречи')}<div class="page-intro"><div><h1>Мои встречи</h1><p>Твои планы и всё, что ты организуешь.</p></div><a class="btn secondary" href="#/events/new">${icon('plus')}Создать</a></div><nav class="page-tabs" aria-label="Тип своих встреч">${[['confirmed','Участвую'],['pending','Заявки'],['created','Организую']].map(([id,label])=>`<a href="#/me/events?tab=${id}" class="page-tab ${tab===id?'active':''}">${label}</a>`).join('')}</nav>${events.length?events.map(e=>`<article class="my-row"><a class="row-icon" href="#/events/${e.id}" aria-label="${esc(e.title)}">${icon(e.icon)}</a><div><h3><a href="#/events/${e.id}">${esc(e.title)}</a></h3><p class="small">${esc(fullDate(e))} · ${time(e)} · ${esc(e.place)}</p></div>${!isPublished(e)?publicationBadge(e):''}${tab==='created'?`<a class="btn secondary" href="#/events/${e.id}/manage">Участники и заявки</a>`:badge(ownParticipation(e)?.status==='CONFIRMED'?'Ты участвуешь':ownParticipation(e)?.status==='PENDING'?'На рассмотрении':'Заявка отклонена',ownParticipation(e)?.status==='CONFIRMED'?'success':ownParticipation(e)?.status==='PENDING'?'info':'error')}</article>`).join(''):empty(tab==='created'?'Пока нет своих встреч':'Здесь пока пусто',tab==='created'?'Придумай занятие и пригласи компанию.':'Найди занятие по душе и присоединяйся.',tab==='created'?'<a class="btn" href="#/events/new">Создать встречу</a>':'<a class="btn" href="#/events">Выбрать встречу</a>')}</div>`;
  }
  function manage(e) {
    if(!state.actor) return authPrompt('Управление встречей','Для просмотра состава и заявок войди как автор этой встречи.');
    if(state.actor!==e.owner)return deniedPage();
    return `<div class="container page">${breadcrumb('Участники и заявки',`#/events/${e.id}`,e.title)}<div class="page-intro"><div><p class="eyebrow red form-eyebrow">Ты организатор</p><h1>${esc(e.title)}</h1><p>Подтверждённые участники и заявки — отдельно.</p></div></div>${!isPublished(e)?'<div class="notice neutral">Публикация недоступна. Состояния записей сохранены, решения по заявкам закрыты.</div>':''}${['PENDING','CONFIRMED','REJECTED'].map(status=>`<section class="section"><div class="section-head"><h2>${status==='PENDING'?'Заявки':status==='CONFIRMED'?'Участники':'Отклонённые заявки'}</h2></div>${e.participants.filter(p=>p.status===status).map(p=>`<div class="my-row">${avatar(p.user,'warm')}<div><h3><a href="#/people/${p.user}">${esc(person(p.user).name)}</a></h3><p class="small">${status==='PENDING'?'Ожидает твоего решения':status==='CONFIRMED'?'Участие подтверждено':'Участие не подтверждено'}</p>${status==='PENDING'?`<p class="small muted">Заявка: ${esc(dateTime(p.createdAt))}</p>`:''}</div>${status==='PENDING'&&isPublished(e)?`<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><button class="btn secondary" data-action="decision" data-id="${e.id}" data-user="${p.user}" data-status="REJECTED">Отклонить</button><button class="btn" data-action="decision" data-id="${e.id}" data-user="${p.user}" data-status="CONFIRMED">Принять</button></div>`:''}</div>`).join('')||'<p class="muted small">Пока никого.</p>'}</section>`).join('')}</div>`;
  }
  const orgStatuses = {
    NOT_SUBMITTED: ['Не отправлена', ''], PENDING: ['На проверке', 'info'],
    APPROVED: ['Допущена к публикации', 'success'], REJECTED: ['Допуск не предоставлен', 'error'],
  };
  const orgBadge = org => badge(...orgStatuses[org.status]);
  const publicationBadge = e => badge(isPublished(e) ? 'Опубликована' : 'Публикация недоступна', isPublished(e) ? 'success' : '');
  const dateTime = value => value ? new Intl.DateTimeFormat('ru-RU', {
    day:'numeric', month:'long', year:visibleYear(value), hour:'2-digit', minute:'2-digit', timeZone:'Asia/Krasnoyarsk',
  }).format(new Date(value)) + ' · UTC+7' : '—';
  const missingPage = () => `<div class="container page"><h1 class="gate-title">Страница не найдена</h1>${empty('Попробуем другой путь','Проверь адрес или выбери встречу в каталоге.')}</div>`;
  const deniedPage = () => `<div class="container page"><h1 class="gate-title">Нет доступа</h1>${empty('Выбери подходящий профиль','Эта страница доступна другому профилю. Можно выбрать подходящий демопрофиль.','<button class="btn" data-action="login">Сменить демопрофиль</button>')}</div>`;
  const safeReturn = value => value?.startsWith('/') && !value.startsWith('//') && !/[\\#\s]/.test(value) ? value : '/events';
  const authReturn = () => safeReturn(getRoute().searchParams.get('returnTo'));
  const dirtyForm = () => getRoute().pathname === '/events/new' ? state.draftDirty : getRoute().pathname === '/organizations/new' && Object.values(state.orgDraft).some(value => value.trim());
  const focusMain = () => main.focus({preventScroll:true});

  function loginOptions() {
    return `<div class="login-options">${[['alex','Участник'],['anna','Автор встреч · представитель организаций'],['admin','Администратор · допуск и модерация']].map(([id,label]) => `<button class="login-option" data-action="choose-profile" data-id="${id}">${avatar(id,'warm')}<span><strong>${esc(person(id).name)}</strong><small>${label}</small></span>${icon('arrow')}</button>`).join('')}</div>`;
  }
  function registrationForm() {
    return `<form data-form="register"><label class="field"><span>Как тебя зовут?</span><input name="name" required maxlength="120" autocomplete="off" placeholder="Твоё имя"></label><button class="btn wide" type="submit">Создать демопрофиль ${icon('arrow')}</button></form>`;
  }
  function authPage(route) {
    const register = route.pathname === '/register', target = encodeURIComponent(authReturn());
    return `<div class="form-page auth-page"><p class="eyebrow red">Познакомимся Рядом</p><h1>${register?'Регистрация':'Вход в Рядом'}</h1><p class="form-description">Демонстрация дизайна. Профили вымышлены, пароля и почты не требуется. Данные живут до перезагрузки.</p><section class="workspace-card">${register?registrationForm():loginOptions()}<a class="text-link" href="#/${register?'login':'register'}?returnTo=${target}">${register?'Уже есть демопрофиль? Войти':'Создать свой демопрофиль'} ${icon('arrow')}</a></section><a class="text-link" href="#${esc(authReturn())}">Вернуться к исходной странице</a></div>`;
  }
  function organizationRows(orgs, admin = false) {
    return orgs.map(org => `<article class="workspace-row">${orgAvatar(false,org.id)}<div class="row-content"><h2><a href="#/${admin?'admin/organizations':'me/organizations'}/${org.id}">${esc(org.name)}</a></h2><p>${esc(org.interests.join(' · '))}</p><small>${org.submittedAt?'Заявка: '+esc(dateTime(org.submittedAt)):'Заявка ещё не подана'}</small></div><div class="row-actions">${orgBadge(org)}<a class="text-link" href="#/${admin?'admin/organizations':'me/organizations'}/${org.id}">Открыть ${icon('arrow')}</a></div></article>`).join('');
  }
  function orgsDiscovery() {
    const approved = state.data.organizations.filter(org => org.status === 'APPROVED');
    const card = org => {
      const count = state.data.events.filter(event => event.organization === org.id && isPublished(event)).length;
      return `<article class="org-card"><div class="org-card-top">${orgAvatar(false, org.id)}<div><h2><a href="#/organizations/${encodeURIComponent(org.id)}">${esc(org.name)}</a></h2><p class="small muted">Ответственный: ${esc(person(org.owner).name)}</p></div></div><p class="org-card-desc">${esc(org.description)}</p><div class="interest-list">${org.interests.map(sport => `<a class="chip" href="#/events?sport=${encodeURIComponent(sport)}">${esc(sport)}</a>`).join('')}</div><p class="small muted">Опубликованных встреч: ${count}</p><div class="org-card-actions"><a class="btn secondary" href="#/organizations/${encodeURIComponent(org.id)}">Открыть организацию ${icon('arrow')}</a></div></article>`;
    };
    return `<div class="container page"><div class="page-intro"><div><p class="eyebrow red form-eyebrow">Компания для спорта</p><h1>Организации рядом</h1><p>Узнай о сообществах и найди их встречи. На каждую встречу записываются отдельно.</p></div><a class="btn secondary" href="#/organizations/new">${icon('plus')}Создать свою</a></div>${approved.length ? `<div class="org-grid">${approved.map(card).join('')}</div>` : empty('Организаций пока нет','Здесь появятся сообщества после допуска администратора.')}<p class="preview-only">У каждой встречи свой состав участников. Выбери встречу организации, чтобы присоединиться.</p></div>`;
  }
  function organizationsPage() {
    if(!state.actor) return authPrompt('Мои организации','Войди, чтобы создать профиль клуба или управлять своими организациями.');
    const orgs = state.data.organizations.filter(org => org.owner === state.actor);
    return `<div class="container page">${breadcrumb('Мои организации','#/me','Мой профиль')}<div class="page-intro"><div><p class="eyebrow red">Твой клуб или сообщество</p><h1>Мои организации</h1><p>Отдельный профиль для общих встреч. Публичная страница появится после допуска.</p></div><a class="btn" href="#/organizations/new">${icon('plus')}Создать профиль</a></div>${orgs.length?`<div class="workspace-list">${organizationRows(orgs)}</div>`:empty('Пока нет организаций','Создай профиль клуба, расскажи о его деятельности и отправь заявку на допуск.','<a class="btn" href="#/organizations/new">Создать профиль организации</a>')}</div>`;
  }
  function newOrganizationPage() {
    if(!state.actor) return authPrompt('Представь своё сообщество','Войди, чтобы создать закрытый профиль организации.');
    const d = state.orgDraft;
    return `<div class="form-page">${breadcrumb('Новая организация','#/me/organizations','Мои организации')}<p class="eyebrow red">Собираете людей вместе?</p><h1>Профиль организации</h1><p class="form-description">Расскажи о клубе или сообществе. Сначала сохраним закрытый профиль; заявку на допуск можно отправить следующим шагом.</p><form data-form="organization" class="workspace-card"><label class="field"><span>Название</span><input name="name" required maxlength="160" value="${esc(d.name)}" placeholder="Как называется сообщество?"></label><label class="field"><span>Чем занимаетесь</span><textarea name="description" required maxlength="4000" placeholder="Для кого ваши встречи и что вы проводите">${esc(d.description)}</textarea></label><label class="field"><span>Спортивные интересы</span><input name="interests" required maxlength="500" value="${esc(d.interests)}" placeholder="Бег, шахматы, зарядка"><small>Несколько направлений через запятую. Можно указать своё.</small></label><div class="notice neutral">${icon('info')}<p>Создание профиля не публикует организацию. Допуск рассматривает администратор.</p></div><div class="form-actions"><a class="text-link" href="#/me/organizations">Вернуться</a><button class="btn" type="submit">Создать профиль ${icon('arrow')}</button></div></form><p class="preview-only">Данные макета сохраняются только до перезагрузки.</p></div>`;
  }
  function organizationDetails(org) {
    return `<dl class="workspace-facts"><dt>Деятельность</dt><dd>${esc(org.description)}</dd><dt>Спортивные интересы</dt><dd>${esc(org.interests.join(' · '))}</dd><dt>Ответственный</dt><dd><a class="text-link" href="#/people/${org.owner}">${esc(person(org.owner).name)} ${icon('arrow')}</a></dd></dl>`;
  }
  function eventRows(events, admin = false) {
    return events.map(e => `<article class="workspace-row"><span class="row-symbol">${icon(e.icon)}</span><div class="row-content"><h2><a href="#/${admin?'admin/events':'events'}/${e.id}">${esc(e.title)}</a></h2><p>${esc(fullDate(e))} · ${time(e)} · UTC+7</p><a class="row-owner" href="${admin&&e.organization?'#/admin/organizations/'+e.organization:ownerLink(e)}">${esc(ownerName(e))}</a></div><div class="row-actions">${publicationBadge(e)}<a class="text-link" href="#/${admin?'admin/events':'events'}/${e.id}">${admin?'Модерация':'Открыть встречу'} ${icon('arrow')}</a>${!admin&&e.owner===state.actor?`<a class="text-link" href="#/events/${e.id}/manage">Участники и заявки</a>`:''}</div></article>`).join('');
  }
  function organizationCabinet(org) {
    if(!state.actor) return authPrompt('Кабинет организации','Войди как ответственный этой организации.');
    if(org.owner !== state.actor) return deniedPage();
    const events = state.data.events.filter(e => e.organization === org.id);
    const texts = {
      NOT_SUBMITTED:['Профиль создан','Он пока не опубликован. Отправь заявку на допуск, чтобы публиковать встречи от имени организации.'],
      PENDING:['Заявка на рассмотрении','До решения администратора профиль остаётся закрытым, публикация встреч недоступна.'],
      REJECTED:['Допуск не предоставлен','Профиль остаётся закрытым. Повторная подача в этой версии не предусмотрена.'],
      APPROVED:['Можно публиковать встречи','Страница организации доступна всем. Встречи выходят сразу, без повторного согласования.'],
    };
    return `<div class="container page">${breadcrumb('Кабинет организации','#/me/organizations','Мои организации')}<div class="page-intro"><div><p class="eyebrow red">Закрытый кабинет организации</p><h1>${esc(org.name)}</h1></div>${orgBadge(org)}</div><section class="workspace-card"><h2>${texts[org.status][0]}</h2><p>${texts[org.status][1]}</p>${org.reason?`<div class="notice error">${icon('info')}<div><strong>Причина отказа</strong>${esc(org.reason)}</div></div>`:''}${org.submittedAt?`<p class="small muted">Заявка отправлена: ${esc(dateTime(org.submittedAt))}</p>`:''}${org.decidedAt?`<p class="small muted">Решение: ${esc(dateTime(org.decidedAt))}</p>`:''}<div class="workspace-actions">${org.status==='NOT_SUBMITTED'?`<button class="btn" data-action="org-submit" data-id="${org.id}">Отправить на проверку ${icon('arrow')}</button>`:org.status==='APPROVED'?`<a class="btn" href="#/events/new?organization=${org.id}">${icon('plus')}Создать встречу от организации</a><a class="btn secondary" href="#/organizations/${org.id}">Публичная страница ${icon('arrow')}</a>`:''}</div></section><section class="workspace-card"><h2>О профиле</h2>${organizationDetails(org)}</section><section class="workspace-section"><div class="section-head"><h2>Встречи организации</h2><span class="small muted">${events.length}</span></div>${events.length?eventRows(events):empty('Встреч пока нет',org.status==='APPROVED'?'Создай первую встречу от имени организации.':'Публикация станет доступна после допуска.',org.status==='APPROVED'?`<a class="btn" href="#/events/new?organization=${org.id}">Создать встречу</a>`:'')}</section></div>`;
  }
  function publicOrganization(org) {
    if(org.status !== 'APPROVED') return missingPage();
    const events = state.data.events.filter(e => e.organization === org.id && isPublished(e));
    return `<div class="container page">${breadcrumb(org.name)}<div class="profile-cover org-cover" aria-hidden="true"></div><section class="profile-header">${orgAvatar(true,org.id)}<div class="profile-info"><h1>${esc(org.name)}</h1><p class="small muted">Спортивное сообщество</p></div>${orgBadge(org)}</section>${org.owner===state.actor?`<a class="text-link" href="#/me/organizations/${org.id}">Кабинет организации ${icon('arrow')}</a>`:''}<div class="profile-content"><aside class="profile-aside"><h2>О сообществе</h2><p>${esc(org.description)}</p><h2 class="aside-heading">Спортивные интересы</h2><div class="interest-list">${org.interests.map(sport=>`<a class="chip" href="#/events?sport=${encodeURIComponent(sport)}">${esc(sport)}</a>`).join('')}</div><p class="preview-only">Допуск означает право публиковать встречи.</p></aside><div><div class="section-head"><h2>Встречи сообщества</h2></div>${events.length?`<div class="event-grid">${events.map(eventCard).join('')}</div>`:empty('Встреч пока нет','Пока можно выбрать встречу в каталоге.')}</div></div></div>`;
  }
  function adminNav(section) {
    return `<div class="admin-heading"><p class="eyebrow red">Администрирование</p><a class="text-link" href="#/me">Мой профиль ${icon('arrow')}</a></div><nav class="page-tabs" aria-label="Разделы модерации"><a class="page-tab ${section==='organizations'?'active':''}" href="#/admin/organizations">Организации</a><a class="page-tab ${section==='events'?'active':''}" href="#/admin/events">Встречи</a></nav>`;
  }
  function adminPage(route) {
    if(!state.actor) return authPrompt('Административный раздел','Войди как Марина, чтобы посмотреть допуск и модерацию.');
    if(!isAdmin()) return deniedPage();
    const parts = route.pathname.split('/').filter(Boolean), section = parts[1], id = parts[2];
    const orgs = section === 'organizations', item = id && (orgs?orgById(id):eventById(id));
    if(id && !item) return missingPage();
    const body = id ? (orgs?adminOrganization(item):adminEvent(item)) : adminList(route,orgs);
    return `<div class="container page">${adminNav(section)}${body}</div>`;
  }
  function adminList(route, orgs) {
    const q=route.searchParams.get('q')||'', status=route.searchParams.get('status')||'', orgId=route.searchParams.get('organization')||'';
    const source=orgs?state.data.organizations:state.data.events;
    const items=source.filter(item=>(!q||`${orgs?item.name:item.title} ${orgs?item.description:ownerName(item)}`.toLocaleLowerCase('ru').includes(q.toLocaleLowerCase('ru').trim()))&&(!status||(orgs?item.status:item.publication)===status)&&(!orgId||!orgs&&item.organization===orgId));
    const states=orgs?Object.entries(orgStatuses).map(([value,[label]])=>[value,label]):[['PUBLISHED','Опубликована'],['UNPUBLISHED','Публикация недоступна']];
    return `<div class="page-intro"><div><h1>${orgs?'Организации':'Встречи'}</h1><p>${orgs?'Все профили и заявки, включая уже рассмотренные.':'Публичные и снятые встречи. Решения об участии принимает автор.'}</p></div></div><form class="admin-search" data-form="admin-search" data-section="${orgs?'organizations':'events'}"><label class="field"><span>Поиск</span><input name="q" type="search" value="${esc(q)}" placeholder="${orgs?'Название или деятельность':'Название или организатор'}"></label><label class="field"><span>${orgs?'Состояние допуска':'Публикация'}</span><select class="control" name="status"><option value="">Все состояния</option>${states.map(([value,label])=>`<option value="${value}" ${status===value?'selected':''}>${label}</option>`).join('')}</select></label>${!orgs?`<label class="field"><span>Организация</span><select class="control" name="organization"><option value="">Все авторы</option>${state.data.organizations.map(org=>`<option value="${org.id}" ${orgId===org.id?'selected':''}>${esc(org.name)}</option>`).join('')}</select></label>`:''}<button class="btn" type="submit">${icon('search')}Найти</button></form><div class="result-line"><span>Найдено: ${items.length}</span><a class="text-link" href="#/admin/${orgs?'organizations':'events'}">Сбросить</a></div>${items.length?`<div class="workspace-list">${orgs?organizationRows(items,true):eventRows(items,true)}</div>`:empty('Ничего не найдено','Попробуй изменить поиск или состояние.',`<a class="btn secondary" href="#/admin/${orgs?'organizations':'events'}">Сбросить поиск</a>`)}`;
  }
  function adminOrganization(org) {
    const events = state.data.events.filter(e => e.organization === org.id);
    return `${breadcrumb(org.name,'#/admin/organizations','Все организации')}<div class="page-intro"><h1>${esc(org.name)}</h1>${orgBadge(org)}</div><section class="workspace-card"><h2>Профиль организации</h2>${organizationDetails(org)}</section><section class="workspace-card"><h2>Заявка на допуск</h2><p>${org.status==='NOT_SUBMITTED'?'Ответственный ещё не подал заявку. Решение пока недоступно.':'Отправлена: '+esc(dateTime(org.submittedAt))}</p>${org.decidedAt?`<p class="small muted">Решение: ${esc(dateTime(org.decidedAt))}</p>`:''}${org.reason?`<div class="notice error">${icon('info')}<div><strong>Причина отказа</strong>${esc(org.reason)}</div></div>`:''}${org.status==='PENDING'?`<div class="workspace-actions"><button class="btn" data-action="moderate" data-kind="approve" data-id="${org.id}">Предоставить допуск</button><button class="btn secondary" data-action="moderate" data-kind="reject" data-id="${org.id}">Отклонить заявку</button></div>`:''}${org.status==='APPROVED'?`<a class="text-link" href="#/organizations/${org.id}">Публичная страница ${icon('arrow')}</a>`:''}</section><section class="workspace-section"><div class="section-head"><h2>Связанные встречи</h2><a class="text-link" href="#/admin/events?organization=${org.id}">В административном списке ${icon('arrow')}</a></div>${events.length?eventRows(events,true):empty('Встреч пока нет','Связанный список остаётся доступным.',`<a class="btn secondary" href="#/admin/events?organization=${org.id}">Открыть список</a>`)}</section>`;
  }
  function discussionMessages(e, admin = false) {
    return e.messages.length ? e.messages.map(message => `<article class="discussion-message ${message.hidden?'message-hidden':''}">${avatar(message.user,'warm')}<div><div class="message-author"><a href="#/people/${message.user}">${esc(person(message.user).name)}</a>${message.user===e.owner?badge('Организатор'):''}<time datetime="${esc(message.createdAt)}">${esc(dateTime(message.createdAt))}</time></div>${message.hidden?`<p class="muted">Сообщение скрыто модератором</p>${admin?`<details><summary>Показать скрытый оригинал</summary><p>${esc(message.body)}</p></details>`:''}`:`<p>${esc(message.body)}</p>`}${admin&&!message.hidden?`<button class="text-link moderation-link" data-action="moderate" data-kind="hide" data-id="${e.id}" data-message="${message.id}">Скрыть сообщение</button>`:''}</div></article>`).join('') : '<p class="muted">Здесь пока нет сообщений.</p>';
  }
  function adminEvent(e) {
    return `${breadcrumb(e.title,'#/admin/events','Все встречи')}<div class="page-intro"><h1>${esc(e.title)}</h1>${publicationBadge(e)}</div><section class="workspace-card"><h2>О встрече</h2><dl class="workspace-facts"><dt>Организатор</dt><dd><a class="text-link" href="${e.organization?'#/admin/organizations/'+e.organization:ownerLink(e)}">${esc(ownerName(e))} ${icon('arrow')}</a></dd><dt>Ответственный автор</dt><dd><a href="#/people/${e.owner}" class="text-link">${esc(person(e.owner).name)} ${icon('arrow')}</a></dd><dt>Когда</dt><dd>${esc(dateTime(e.date))}</dd><dt>Где</dt><dd>${esc(e.city)}, ${esc(e.place)}</dd><dt>Направление</dt><dd>${esc(e.sport)}</dd><dt>Запись</dt><dd>${e.mode==='OPEN'?'Свободная запись':'По заявке'}</dd><dt>Описание</dt><dd>${esc(e.description)}</dd><dt>Условия</dt><dd>${esc(e.conditions)}</dd></dl><a class="text-link" href="#/events/${e.id}">Посмотреть страницу встречи ${icon('arrow')}</a></section><section class="workspace-card"><h2>Публикация</h2>${isPublished(e)?`<p>Снятие уберёт встречу из поиска и закроет новые записи и вопросы. Существующие записи сохранятся.</p><button class="btn" data-action="moderate" data-kind="unpublish" data-id="${e.id}">Снять с публикации</button>`:`<div class="notice neutral">${icon('info')}<div><strong>Причина снятия</strong>${esc(e.moderationReason)}</div></div><p class="small muted">${esc(dateTime(e.unpublishedAt))}. Восстановление в этой версии не предусмотрено.</p>`}</section><section class="workspace-card" id="discussion"><h2>Обсуждение</h2><p>Скрытие отдельного сообщения сохраняет встречу и остальной разговор.</p>${discussionMessages(e,true)}</section>`;
  }
  function unavailableEvent(e, preview = false) {
    const own = state.actor === e.owner, participation = ownParticipation(e);
    if(!preview&&!own&&!isAdmin()&&!participation) return missingPage();
    return `<div class="container page">${breadcrumb(e.title,'#'+state.catalogPath,'К результатам')}<div class="page-intro"><h1>${esc(e.title)}</h1></div><div class="notice neutral">${icon('info')}<div><strong>Публикация недоступна</strong>Присоединиться, отправить заявку или новый вопрос больше нельзя. Это не подтверждение отмены самой встречи.</div></div>${participation?`<p class="status-line">${badge(participation.status==='CONFIRMED'?'Участие подтверждено':participation.status==='PENDING'?'Заявка ожидает решения':'Заявка отклонена')}<span class="small muted">Состояние прежней записи сохранено.</span></p>`:''}${own||isAdmin()?`<section class="workspace-card"><h2>Причина снятия</h2><p>${esc(e.moderationReason||'Условия встречи требуют уточнения (пример состояния).')}</p></section>`:'<p class="small muted status-line">Публикация стала недоступна. Новые действия со встречей закрыты.</p>'}<div class="workspace-actions"><a class="btn secondary" href="#/me/events">Мои встречи</a><a class="text-link" href="#/events">Посмотреть другие встречи ${icon('arrow')}</a>${own?`<a class="text-link" href="#/events/${e.id}/manage">Участники и заявки</a>`:''}${isAdmin()?`<a class="text-link" href="#/admin/events/${e.id}">К модерации</a>`:''}</div></div>`;
  }
  function openModeration(kind,id,messageId) {
    if(!isAdmin()) return;
    const org = ['approve','reject'].includes(kind) ? orgById(id) : null;
    const e = org ? null : eventById(id), message = e?.messages.find(item=>item.id===messageId);
    if(org&&org.status!=='PENDING'||!org&&(!e||kind==='unpublish'&&!isPublished(e)||kind==='hide'&&(!message||message.hidden))) {notify('Состояние уже изменилось. Обнови страницу.');return;}
    const copy = {
      approve:['Предоставить допуск?','Организация получит публичную страницу и сможет публиковать встречи без повторного согласования.','Предоставить допуск'],
      reject:['Отклонить заявку?','Организация останется закрытой. Ответственный увидит указанную причину отказа.','Отклонить заявку'],
      unpublish:['Снять встречу с публикации?','Встреча исчезнет из поиска. Новая запись и новые вопросы станут недоступны. Существующие записи сохранятся.','Снять с публикации'],
      hide:['Скрыть это сообщение?','Остальные сообщения и сама встреча останутся доступными. Читатели увидят подпись вместо текста.','Скрыть сообщение'],
    }[kind];
    if(!copy) return;
    modal.innerHTML=`<div class="modal-top"><h2 id="modal-title">${copy[0]}</h2><button class="icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div><p class="modal-object">${esc(org?.name||e.title)}</p><p class="modal-note">${copy[1]}</p>${message?`<blockquote class="message-excerpt"><strong>${esc(person(message.user).name)}</strong><p>${esc(message.body.slice(0,220))}</p></blockquote>`:''}<form data-form="moderation" data-kind="${kind}" data-id="${id}" data-message="${esc(messageId)}">${['reject','unpublish'].includes(kind)?'<label class="field reason-field"><span>Причина</span><textarea name="reason" required maxlength="2000" placeholder="Объясни, почему принято такое решение"></textarea></label>':''}<p class="form-error" data-modal-error role="alert" hidden></p><div class="form-actions"><button class="btn secondary" type="button" data-action="close-modal">Вернуться</button><button class="btn" type="submit">${copy[2]}</button></div></form>`;
    modal.showModal();
  }
  function submitModeration(form,data) {
    const {kind,id,message:messageId} = form.dataset;
    const fail = text => {const error=modal.querySelector('[data-modal-error]');error.textContent=text;error.hidden=false;};
    if(!isAdmin()) {fail('Действие доступно только администратору.');return;}
    const reason=String(data.get('reason')||'').trim();
    if(['reject','unpublish'].includes(kind)&&!reason) {fail('Укажи причину решения.');return;}
    const now = new Date().toISOString();
    if(['approve','reject'].includes(kind)) {
      const org=orgById(id);
      if(!org||org.status!=='PENDING') {fail('По заявке уже принято решение. Закрой диалог и проверь текущий статус.');return;}
      org.status=kind==='approve'?'APPROVED':'REJECTED';org.reason=kind==='reject'?reason:'';org.decidedAt=now;
    } else {
      const e=eventById(id);
      if(!e) {fail('Встреча больше недоступна.');return;}
      if(kind==='unpublish') {
        if(!isPublished(e)) {fail('Встреча уже снята с публикации.');return;}
        e.publication='UNPUBLISHED';e.moderationReason=reason;e.unpublishedAt=now;
      } else if(kind==='hide') {
        const message=e.messages.find(item=>item.id===messageId);
        if(!message||message.hidden) {fail('Сообщение уже скрыто или недоступно.');return;}
        message.hidden=true;
      } else return;
    }
    closeModal();state.preview='DEFAULT';render();focusMain();notify('Результат изменён в локальном макете');
  }
  function render() {
    const route=getRoute(), parts=route.pathname.split('/').filter(Boolean);
    renderChrome(route);
    let html, title='Рядом';
    if(route.pathname==='/') html=home();
    else if(route.pathname==='/events') {html=catalog(route);title='Встречи';}
    else if(route.pathname==='/events/new') {html=createPage();title='Новая встреча';}
    else if(parts[0]==='events'&&eventById(parts[1])&&(parts.length===2||parts.length===3&&parts[2]==='manage')) {const e=eventById(parts[1]);html=parts[2]==='manage'?manage(e):eventPage(e);title=isPublished(e)||state.actor===e.owner||isAdmin()||ownParticipation(e)?e.title:'Страница не найдена';}
    else if(parts[0]==='people'&&parts.length===2&&state.data.people[parts[1]]) {html=profile(parts[1]);title=person(parts[1]).name;}
    else if(route.pathname==='/orgs') {html=orgsDiscovery();title='Организации';}
    else if(route.pathname==='/organizations/new') {html=newOrganizationPage();title='Новая организация';}
    else if(parts[0]==='organizations'&&parts.length===2&&orgById(parts[1])) {const org=orgById(parts[1]);html=publicOrganization(org);title=org.status==='APPROVED'?org.name:'Страница не найдена';}
    else if(route.pathname==='/me/organizations') {html=organizationsPage();title='Мои организации';}
    else if(parts[0]==='me'&&parts[1]==='organizations'&&parts.length===3&&orgById(parts[2])) {html=organizationCabinet(orgById(parts[2]));title='Кабинет организации';}
    else if(route.pathname==='/me'||route.pathname==='/me/events') {html=myPage(route);title=route.pathname==='/me'?'Профиль':'Мои встречи';}
    else if(route.pathname==='/login'||route.pathname==='/register') {html=authPage(route);title=route.pathname==='/login'?'Вход':'Регистрация';}
    else if(parts[0]==='admin'&&['organizations','events'].includes(parts[1])&&[2,3].includes(parts.length)) {html=adminPage(route);title='Допуск и модерация';}
    else html=missingPage();
    main.innerHTML=html; document.title=`${title} — Рядом · прототип`;
    if(state.filterFocus){
      const {name,value}=state.filterFocus;
      const field=[...main.querySelectorAll('[data-form="filters"] input')].find(el=>el.name===name&&el.value===value);
      field?.focus({preventScroll:true});state.filterFocus=null;
    }
  }
  function closeModal() {modal.close();}
  function openLogin() {
    modal.innerHTML=`<div class="modal-top"><h2 id="modal-title">Встречаемся Рядом</h2><button class="icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div><p class="modal-note">Выбери профиль для просмотра макета. Данные вымышлены, изменения сохраняются до перезагрузки.</p>${loginOptions()}<button class="text-link" data-action="register">Создать свой демопрофиль ${icon('arrow')}</button>`;
    modal.showModal();
  }
  function collectDraft(form) {for(const [key,value] of new FormData(form))state.draft[key]=String(value);}
  function clearPrivateDrafts() {state.draft={};state.draftDirty=false;state.orgDraft={};state.step=1;state.questions={};}
  function finishLogin() {
    const route=getRoute();
    if(['/login','/register'].includes(route.pathname))go(authReturn());
    else render();
    focusMain();
  }
  document.addEventListener('input',event=>{
    const form=event.target.closest('form');
    if(form?.dataset.form==='create'){collectDraft(form);state.draftDirty=true;}
    if(form?.dataset.form==='organization')for(const [key,value] of new FormData(form))state.orgDraft[key]=String(value);
    if(form?.dataset.form==='question')state.questions[form.dataset.event]=form.elements.body.value;
  });
  document.addEventListener('change',event=>{
    const el=event.target, action=el.dataset.action;
    if(action==='screen'){state.preview='DEFAULT';go(el.value);}
    else if(action==='preview'){state.preview=el.value;if(['PENDING','CONFIRMED','REJECTED'].includes(el.value)||el.value==='UNPUBLISHED'&&!state.actor)state.actor='alex';render();}
    else if(action==='draft-sport'){collectDraft(el.form);delete state.draft.art;state.draftDirty=true;render();(main.querySelector('[name="customSport"]')||main.querySelector('[name="sport"]'))?.focus();}
    else if(el.closest('[data-form="filters"]')){state.filtersOpen=el.closest('details').open;state.filterFocus={name:el.name,value:el.value};const route=getRoute(),data=new FormData(el.form);for(const key of ['sport','mode','day']){const value=data.get(key);if(value)route.searchParams.set(key,value);else route.searchParams.delete(key);}go('/events'+(route.search?'?'+route.searchParams.toString():''));}
    else if(el.closest('[data-form="create"]')){collectDraft(el.form);state.draftDirty=true;}
  });
  document.addEventListener('click',event=>{
    const link=event.target.closest('a');
    if(link?.classList.contains('skip-link')){event.preventDefault();focusMain();main.scrollIntoView();return;}
    if(link?.getAttribute('href')?.startsWith('#/')&&dirtyForm()){event.preventDefault();go(link.getAttribute('href').slice(1));return;}
    const control=event.target.closest('[data-action]');if(!control||control.tagName==='SELECT')return;
    const action=control.dataset.action,id=control.dataset.id;
    if(action==='login')openLogin();
    else if(action==='close-modal')closeModal();
    else if(action==='choose-profile'){
      if(!state.data.people[id])return;
      if(state.actor&&state.actor!==id)clearPrivateDrafts();
      state.actor=id;state.preview='DEFAULT';closeModal();finishLogin();notify(`Демопрофиль: ${person(id).name}`);
    }
    else if(action==='leave-form'){clearPrivateDrafts();closeModal();go(control.dataset.path);}
    else if(action==='logout'){clearPrivateDrafts();state.actor=null;state.preview='DEFAULT';go('/');notify('Вы вышли из демопрофиля');}
    else if(action==='register'){
      modal.innerHTML=`<div class="modal-top"><h2 id="modal-title">Давай познакомимся</h2><button class="icon-button" data-action="close-modal" aria-label="Закрыть">${icon('close')}</button></div><p class="modal-note">Создай вымышленный профиль. Пароль и почта не нужны.</p>${registrationForm()}`;
      modal.querySelector('input').focus();
    }
    else if(action==='join'){
      const e=eventById(id);if(!e||!isPublished(e)){notify('Публикация недоступна');render();return;}
      if(!state.actor){openLogin();return;}
      if(state.actor===e.owner)return;
      if(!ownParticipation(e))e.participants.push({user:state.actor,status:e.mode==='OPEN'?'CONFIRMED':'PENDING',createdAt:new Date().toISOString()});
      state.preview='DEFAULT';render();notify(e.mode==='OPEN'?'Ты в списке участников':'Заявка отправлена организатору');
    }
    else if(action==='retry'){state.preview='DEFAULT';render();}
    else if(action==='clear-filters')go('/events');
    else if(action==='step-back'){collectDraft(control.form);state.step=Math.max(1,state.step-1);render();focusMain();scrollTo({top:0,behavior:'smooth'});}
    else if(action==='decision'){
      const e=eventById(id);if(!e||state.actor!==e.owner||!isPublished(e))return;
      const p=e.participants.find(p=>p.user===control.dataset.user),status=control.dataset.status;
      if(p?.status==='PENDING'&&['CONFIRMED','REJECTED'].includes(status)){p.status=status;render();focusMain();notify(status==='CONFIRMED'?'Участие подтверждено':'Заявка отклонена');}
    }
    else if(action==='org-submit'){
      const org=orgById(id);if(!org||org.owner!==state.actor||org.status!=='NOT_SUBMITTED')return;
      org.status='PENDING';org.submittedAt=new Date().toISOString();render();focusMain();notify('Заявка отправлена в локальном макете');
    }
    else if(action==='moderate')openModeration(control.dataset.kind,id,control.dataset.message);
    else if(action==='reset'){
      state.data=JSON.parse(JSON.stringify(initial));clearPrivateDrafts();state.actor=null;state.preview='DEFAULT';state.catalogPath='/events';state.filtersOpen=null;state.filterFocus=null;closeModal();go('/');notify('Макет возвращён в начальное состояние');
    }
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(!form.dataset.form)return;event.preventDefault();
    const data=new FormData(form);
    if(form.dataset.form==='search'){
      const route=getRoute(),q=route.pathname==='/events'?new URLSearchParams(route.search):new URLSearchParams();
      for(const key of ['q','city']){const value=data.get(key)?.trim();if(value)q.set(key,value);else q.delete(key);}go('/events'+(q.size?'?'+q:''));
    }
    else if(form.dataset.form==='admin-search'){
      const q=new URLSearchParams();for(const key of ['q','status','organization']){const value=data.get(key)?.trim();if(value)q.set(key,value);}
      go('/admin/'+form.dataset.section+(q.size?'?'+q:''));
    }
    else if(form.dataset.form==='question'){
      const e=eventById(form.dataset.event);if(!e||!isPublished(e)){notify('Публикация недоступна. Новый вопрос не отправлен.');render();return;}
      const body=String(data.get('body')||'').trim();
      if(!body){form.elements.body.setCustomValidity('Напиши вопрос');form.elements.body.reportValidity();form.elements.body.setCustomValidity('');return;}
      state.questions[e.id]=body;if(!state.actor){openLogin();return;}
      e.messages.push({id:uniqueId('message'),user:state.actor,body,createdAt:new Date().toISOString(),hidden:false});state.questions[e.id]='';
      const y=scrollY;render();main.querySelector('[data-form="question"] textarea')?.focus({preventScroll:true});scrollTo(0,y);notify('Вопрос добавлен в обсуждение макета');
    }
    else if(form.dataset.form==='register'){
      const name=String(data.get('name')||'').trim();if(!name){form.elements.name.setCustomValidity('Напиши имя');form.elements.name.reportValidity();form.elements.name.setCustomValidity('');return;}
      const id=uniqueId('demo');state.data.people[id]={name,initials:name.split(/\s+/).slice(0,2).map(w=>w[0]).join('').toUpperCase()};
      if(state.actor)clearPrivateDrafts();state.actor=id;state.draft={};state.draftDirty=false;state.orgDraft={};state.step=1;closeModal();finishLogin();notify('Демопрофиль создан');
    }
    else if(form.dataset.form==='organization'){
      if(!state.actor)return;
      const values=Object.fromEntries(['name','description','interests'].map(key=>[key,String(data.get(key)||'').trim()]));
      for(const key of ['name','description','interests'])if(!values[key]){form.elements[key].setCustomValidity('Заполни поле');form.elements[key].reportValidity();form.elements[key].setCustomValidity('');return;}
      const interests=[...new Set(values.interests.split(',').map(value=>value.trim()).filter(Boolean))];
      if(!interests.length){form.elements.interests.setCustomValidity('Укажи хотя бы одно направление');form.elements.interests.reportValidity();form.elements.interests.setCustomValidity('');return;}
      const org={id:uniqueId('org'),name:values.name,description:values.description,interests,initials:values.name.split(/\s+/).slice(0,2).map(word=>word[0]).join('').toUpperCase(),owner:state.actor,status:'NOT_SUBMITTED'};
      state.data.organizations.push(org);state.orgDraft={};go('/me/organizations/'+org.id);notify('Создан закрытый профиль в локальном макете');
    }
    else if(form.dataset.form==='moderation')submitModeration(form,data);
    else if(form.dataset.form==='create'){
      if(!state.actor)return;
      collectDraft(form);state.draftDirty=true;
      const org=state.draft.organizer&&state.draft.organizer!=='personal'?orgById(state.draft.organizer):null;
      if(state.draft.organizer!=='personal'&&(!org||org.owner!==state.actor||org.status!=='APPROVED')){notify('Для публикации от организации нужен её допуск');return;}
      const when=new Date(`${state.draft.date}T${state.draft.time}:00+07:00`);
      if(state.step===1){
        if(!Number.isFinite(when.getTime())||when<=new Date()){form.elements.date.setCustomValidity('Выбери дату и время в будущем');form.elements.date.reportValidity();form.elements.date.setCustomValidity('');return;}
        if(when>new Date(Date.now()+366*24*60*60*1000)){form.elements.date.setCustomValidity('Выбери дату не позже чем через год');form.elements.date.reportValidity();form.elements.date.setCustomValidity('');return;}
        for(const key of ['title','sport','description','city','place',...(state.draft.sport==='custom'?['customSport']:[])])if(!state.draft[key]?.trim()){form.elements[key].setCustomValidity('Заполни поле');form.elements[key].reportValidity();form.elements[key].setCustomValidity('');return;}
      }
      if(state.step<3){state.step++;render();focusMain();scrollTo({top:0,behavior:'smooth'});}
      else {
        if(!Number.isFinite(when.getTime())||when<=new Date()){state.step=1;render();focusMain();notify('Время начала уже прошло. Выбери новое время.');return;}
        const e=draftEvent();e.id=uniqueId('demo');state.data.events.unshift(e);state.draft={};state.draftDirty=false;state.step=1;go('/events/'+e.id);notify('Встреча добавлена в каталог макета');
      }
    }
  });
  document.addEventListener('toggle',event=>{if(event.target.isConnected&&event.target.matches('.filter-panel'))state.filtersOpen=event.target.open;},true);
  window.addEventListener('hashchange',()=>{const filterUpdate=Boolean(state.filterFocus);state.preview='DEFAULT';render();if(!filterUpdate){focusMain();scrollTo(0,0);}});
  window.addEventListener('beforeunload',event=>{if(dirtyForm()){event.preventDefault();event.returnValue='';}});
  render();
})();
