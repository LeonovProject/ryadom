const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
// This checks local prototype transitions with a mocked DOM, not browser layout or server behavior.
const path=require('node:path');
const root=path.resolve(__dirname,'../design/prototype')+path.sep;
const listeners={},winListeners={};
const elements=new Map();
function element(){return {innerHTML:'',textContent:'',hidden:false,open:false,focus(){},scrollIntoView(){},close(){this.open=false},showModal(){this.open=true},querySelectorAll(){return []},querySelector(){return {focus(){}}}}}
for(const id of ['main','prototype-bar','site-header','site-footer','mobile-nav','toast','modal'])elements.set('#'+id,element());
let hash='#/';
// Dates must stay within the +1 year creation limit.
const futureDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Krasnoyarsk'}).format(new Date(Date.now()+180*24*60*60*1000));
const futureYear=futureDate.slice(0,4);
const location={get hash(){return hash},set hash(value){hash=value.startsWith('#')?value:'#'+value;(winListeners.hashchange||[]).forEach(fn=>fn())}};
const ctx={document:{querySelector:q=>elements.get(q),addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn)},location,innerWidth:1280,scrollY:0,scrollTo(){},setTimeout:()=>1,clearTimeout(){},console,URL,URLSearchParams,Date,Intl,FormData:class{constructor(form){this.values=form.values||{}}*[Symbol.iterator](){yield*Object.entries(this.values)}get(key){return this.values[key]??null}}};
ctx.window={addEventListener:(type,fn)=>(winListeners[type]??=[]).push(fn)};
vm.createContext(ctx);vm.runInContext(fs.readFileSync(root+'data.js','utf8'),ctx);vm.runInContext(fs.readFileSync(root+'app.js','utf8'),ctx);
const content=()=>elements.get('#main').innerHTML;
const modal=()=>elements.get('#modal');
function emit(type,target){for(const fn of listeners[type]||[])fn({target,preventDefault(){}})}
function action(name,dataset={}){const el={dataset:{action:name,...dataset},tagName:'BUTTON',closest(selector){return selector==='[data-action]'?this:null}};emit('click',el)}
function change(name,value){emit('change',{dataset:{action:name},value,closest(){return null}})}
function navigate(path){location.hash=path}
function submit(type,values={},extra={}){const fields={};for(const key of Object.keys(values))fields[key]={setCustomValidity(){},reportValidity(){},value:values[key]};emit('submit',{dataset:{form:type,...extra},values,elements:fields})}
for(const [path,expected] of [['/','Есть планы.'],['/events','Найди свои планы'],['/events/run','Бежим вдоль Енисея'],['/people/anna','Анна Лебедева'],['/organizations/temp','Спортивные интересы'],['/events/new','Соберём компанию?']]){navigate(path);assert(content().includes(expected),path);}
navigate('/events?sport='+encodeURIComponent('Теннис'));assert.equal((content().match(/<article class="event-card">/g)||[]).length,1);
navigate('/events?q=no-such-fixture');assert(content().includes('Пока ничего не нашлось'));
navigate('/events/tennis');action('join',{id:'tennis'});assert(modal().open);action('choose-profile',{id:'alex'});action('join',{id:'tennis'});assert(content().includes('Ожидает решения'));
action('join',{id:'tennis'});navigate('/me/events?tab=pending');assert(content().includes('Теннис без спешки'));
action('logout');navigate('/events/tennis');action('login');action('choose-profile',{id:'anna'});navigate('/events/tennis/manage');assert(content().includes('Алексей Миронов'));action('decision',{id:'tennis',user:'alex',status:'CONFIRMED'});
action('logout');navigate('/events/tennis');action('login');action('choose-profile',{id:'alex'});assert(content().includes('Участие подтверждено'));
for(const status of ['PENDING','CONFIRMED','REJECTED','UNPUBLISHED','ERROR','LOADING']){change('preview',status);assert(content().length>100,status)}change('preview','DEFAULT');
action('logout');navigate('/events/run');submit('question',{body:'Можно ли прийти впервые?'},{event:'run'});assert(modal().open);action('choose-profile',{id:'alex'});assert(content().includes('Можно ли прийти впервые?'));submit('question',{body:'Можно ли прийти впервые?'},{event:'run'});assert(content().includes('<p>Можно ли прийти впервые?</p>'));
navigate('/events/new');submit('create',{organizer:'personal',title:'Тестовая встреча',sport:'custom',customSport:'Фрисби',description:'Описание вымышленной встречи',date:futureDate,time:'10:00',city:'Красноярск',place:'В парке'});assert(content().includes('Как можно присоединиться?'));submit('create',{mode:'OPEN',conditions:''});assert(content().includes('Всё выглядит правильно?'));submit('create',{});assert(content().includes('Тестовая встреча'));assert(content().includes('Фрисби'));assert(content().includes(futureYear));assert(hash.startsWith('#/events/demo-'));
navigate('/events/new');emit('input',{closest:()=>({dataset:{form:'create'},values:{title:'Не сохранено'}})});change('screen','/events');assert(modal().open);assert(modal().innerHTML.includes('Выйти из создания?'));action('leave-form',{path:'/events'});assert.equal(hash,'#/events');
action('reset');assert.equal(hash,'#/');navigate('/events');assert(!content().includes('Тестовая встреча'));
// Behavioral checks for the second screen review; this still mocks the DOM.
ctx.innerWidth=390;
navigate('/events?sport='+encodeURIComponent('Теннис')+'&mode=APPROVAL&day=2026-10-25');
submit('search',{q:'спешки',city:''});
let params=new URL(hash.slice(1),'http://prototype.local').searchParams;
assert.equal(params.get('sport'),'Теннис');assert.equal(params.get('mode'),'APPROVAL');assert.equal(params.get('day'),'2026-10-25');assert.equal(params.get('q'),'спешки');assert.equal(params.has('city'),false);
assert(content().includes('value=""'));assert(content().includes('Выбранные фильтры'));
const catalogPath=hash.slice(1);navigate('/events/tennis');assert(content().includes('href="#'+catalogPath.replace(/&/g,'&amp;')+'"'));
navigate('/events');
const filterForm={values:{sport:'Теннис',mode:'APPROVAL',day:''}};
const panel={open:true};
const filterControl={name:'sport',value:'Теннис',dataset:{},form:filterForm,closest(selector){return selector==='details'?panel:selector==='[data-form="filters"]'?filterForm:null}};
emit('change',filterControl);
assert(content().includes('<details class="filter-panel" open>'));assert(content().includes('aria-label="Выбранные фильтры"'));
navigate('/');const home=content();assert(home.indexOf('Шахматы за одним столом')<home.indexOf('Утро начинается с движения'));assert(!home.includes('<h3>Теннис без спешки</h3>'));
action('logout');navigate('/events/run');submit('question',{body:'Вопрос до регистрации'},{event:'run'});action('register');submit('register',{name:'Новый участник'});assert(content().includes('Вопрос до регистрации'));assert(!content().includes('<p>Вопрос до регистрации</p>'));submit('question',{body:'Вопрос до регистрации'},{event:'run'});assert(content().includes('<p>Вопрос до регистрации</p>'));
action('reset');navigate('/events/tennis');action('join',{id:'tennis'});action('choose-profile',{id:'alex'});action('join',{id:'tennis'});action('login');action('choose-profile',{id:'anna'});navigate('/events/tennis/manage');action('decision',{id:'tennis',user:'alex',status:'REJECTED'});action('login');action('choose-profile',{id:'alex'});navigate('/events/tennis');assert(content().includes('Заявка отклонена'));
action('reset');
console.log('PASS: search retains sport/mode/date, empty city remains unfiltered, event return URL retains query, mobile filters remain open with visible selection, home date order, question survives registration without auto-post, rejection visible to requester. Focus and layout need a browser.');
// Organization and administrator flows use visible routes and controls.
action('reset');
navigate('/me/organizations');assert(content().includes('Войти или зарегистрироваться'));
navigate('/login?returnTo='+encodeURIComponent('/me/organizations'));action('choose-profile',{id:'anna'});assert.equal(hash,'#/me/organizations');
assert(content().includes('Шахматный кружок'));assert(content().includes('Допуск не предоставлен'));
navigate('/organizations/rook');assert(content().includes('Страница не найдена'));assert(!content().includes('Шахматный кружок'));
navigate('/me/organizations/rook');assert(content().includes('Заявка на рассмотрении'));
navigate('/events/new?organization=rook');assert(content().includes('Публикация пока недоступна'));
navigate('/admin/organizations');assert(content().includes('Нет доступа'));
action('login');action('choose-profile',{id:'admin'});navigate('/admin/organizations');assert(content().includes('Шахматный кружок'));
submit('admin-search',{q:'Ход',status:'PENDING'},{section:'organizations'});assert(content().includes('Шахматный кружок'));assert(!content().includes('Беговой клуб «Пульс»'));
navigate('/admin/organizations/rook');action('moderate',{kind:'approve',id:'rook'});assert(modal().open);submit('moderation',{}, {kind:'approve',id:'rook'});assert(content().includes('Допущена к публикации'));
navigate('/admin/organizations/pulse');action('moderate',{kind:'reject',id:'pulse'});submit('moderation',{reason:'   '},{kind:'reject',id:'pulse'});assert(modal().open);assert(content().includes('Предоставить допуск'));submit('moderation',{reason:'Уточните формат и деятельность клуба.'},{kind:'reject',id:'pulse'});assert(content().includes('Уточните формат и деятельность клуба.'));assert(!content().includes('data-kind="approve"'));
action('login');action('choose-profile',{id:'anna'});navigate('/me/organizations/pulse');assert(content().includes('Уточните формат и деятельность клуба.'));assert(!content().includes('Создать встречу от организации'));
navigate('/me/organizations/rook');assert(content().includes('Создать встречу от организации'));navigate('/events/new?organization=rook');assert(content().includes('value="rook" selected'));
submit('create',{organizer:'rook',title:'Новая партия кружка',sport:'Шахматы',description:'Вымышленная встреча клуба',date:futureDate,time:'16:00',city:'Красноярск',place:'Зал клуба'});submit('create',{mode:'OPEN',conditions:''});submit('create',{});assert(content().includes('Новая партия кружка'));assert(content().includes('Шахматный кружок'));const newClubEvent=hash.slice('#/events/'.length);
navigate('/organizations/rook');assert(content().includes('Новая партия кружка'));
navigate('/organizations/new');submit('organization',{name:'Новый <клуб>',description:'Описание нового клуба',interests:'Фрисби, Бег'});assert(content().includes('Новый &lt;клуб&gt;'));assert(content().includes('Профиль создан'));const createdOrg=hash.split('/').at(-1);action('org-submit',{id:createdOrg});assert(content().includes('Заявка на рассмотрении'));
navigate('/me/organizations/yard');action('org-submit',{id:'yard'});assert(content().includes('Заявка на рассмотрении'));
// Hiding one message retains its neighbor and event; ordinary readers never get its body.
action('login');action('choose-profile',{id:'admin'});navigate('/admin/events/tennis');action('moderate',{kind:'hide',id:'tennis',message:'tennis-message-1'});assert(modal().innerHTML.includes('Елена Орлова'));submit('moderation',{}, {kind:'hide',id:'tennis',message:'tennis-message-1'});assert(content().includes('Показать скрытый оригинал'));assert(content().includes('Можно приехать немного раньше'));
navigate('/events/tennis');assert(content().includes('Сообщение скрыто модератором'));assert(!content().includes('Можно приехать немного раньше'));assert(content().includes('Да, буду на месте'));
// Admin cannot decide another author's participation requests.
action('decision',{id:'tennis',user:'kirill',status:'CONFIRMED'});action('login');action('choose-profile',{id:'anna'});navigate('/events/tennis/manage');assert(content().includes('data-user="kirill"'));
// Give Alex a pending record, then unpublish and check each audience and stale controls.
action('login');action('choose-profile',{id:'alex'});navigate('/events/tennis');action('join',{id:'tennis'});assert(content().includes('Заявка отправлена'));
action('login');action('choose-profile',{id:'admin'});navigate('/admin/events/tennis');action('moderate',{kind:'unpublish',id:'tennis'});submit('moderation',{reason:''},{kind:'unpublish',id:'tennis'});assert(modal().open);submit('moderation',{reason:'Уточнить место проведения.'},{kind:'unpublish',id:'tennis'});assert(content().includes('Уточнить место проведения.'));
navigate('/admin/events?status=UNPUBLISHED');assert(content().includes('Теннис без спешки'));
action('login');action('choose-profile',{id:'alex'});navigate('/events/tennis');assert(content().includes('Публикация недоступна'));assert(content().includes('Состояние прежней записи сохранено'));assert(!content().includes('Уточнить место проведения.'));assert(!content().includes('data-form="question"'));
action('join',{id:'tennis'});submit('question',{body:'Нельзя отправить после снятия'},{event:'tennis'});navigate('/me/events?tab=pending');assert(content().includes('Теннис без спешки'));assert(content().includes('Публикация недоступна'));
action('login');action('choose-profile',{id:'anna'});navigate('/events/tennis');assert(content().includes('Уточнить место проведения.'));navigate('/events/tennis/manage');assert(!content().includes('data-action="decision"'));action('decision',{id:'tennis',user:'alex',status:'CONFIRMED'});
action('login');action('choose-profile',{id:'alex'});navigate('/me/events?tab=pending');assert(content().includes('Теннис без спешки'));
action('logout');navigate('/events/tennis');assert(content().includes('Страница не найдена'));assert(!content().includes('Теннис без спешки'));assert(!elements.get('#main').innerHTML.includes('Нельзя отправить после снятия'));
navigate('/events');assert(!content().includes('<h3>Теннис без спешки</h3>'));navigate('/organizations/temp');assert(!content().includes('Теннис без спешки'));
// An ordinary participant cannot open another organization's cabinet or issue a decision.
action('login');action('choose-profile',{id:'alex'});navigate('/me/organizations/rook');assert(content().includes('Нет доступа'));action('org-submit',{id:'height'});navigate('/organizations/height');assert(content().includes('Страница не найдена'));
navigate('/register?returnTo='+encodeURIComponent('/events/'+newClubEvent));submit('register',{name:'Новый участник'});assert.equal(hash,'#/events/'+newClubEvent);
navigate('/login?returnTo='+encodeURIComponent('//example.com'));action('choose-profile',{id:'alex'});assert.equal(hash,'#/events');
// Leaving a form warns after any meaningful field, even without its title/name.
navigate('/events/new');emit('input',{closest:()=>({dataset:{form:'create'},values:{description:'Описание без заголовка'}})});change('screen','/events');assert(modal().open);action('leave-form',{path:'/events'});
navigate('/organizations/new');emit('input',{closest:()=>({dataset:{form:'organization'},values:{description:'Описание без названия'}})});change('screen','/events');assert(modal().open);action('leave-form',{path:'/events'});
action('reset');
console.log('PASS: organization creation/submission, private and public access, approval/rejection with required reason, publication after approval, admin search/navigation, single-message hiding, unpublication for all audiences and stale actions, safe login return, form warnings. All data is in memory.');
// Imported design review: discovery is read-only and covers remain local, allowlisted assets.
action('reset');navigate('/orgs');assert(content().includes('Организации рядом'));
assert.equal((content().match(/<article class="org-card">/g)||[]).length,5);
assert(!content().includes('data-action="org-join"'));assert(!content().includes('Шахматный кружок «Ход»'));assert(!content().includes('Клуб «Высота»'));
navigate('/organizations/temp');assert(!content().includes('data-action="org-join"'));assert(!content().includes('вступление по заявке'));
action('login');action('choose-profile',{id:'alex'});navigate('/events/new');
submit('create',{organizer:'personal',title:'Проверка обложки',sport:'custom',customSport:'Фрисби',description:'Встреча',date:futureDate,time:'10:00',city:'Красноярск',place:'Парк'});
assert(content().includes('<legend>Обложка встречи</legend>'));
submit('create',{art:'bike-blue',mode:'OPEN',conditions:'Вода'});assert(content().includes('assets/event-art/bike-blue.svg'));
submit('create',{});assert(content().includes('assets/event-art/bike-blue.svg'));
navigate('/events/new');submit('create',{organizer:'personal',title:'Волейбол',sport:'Волейбол',description:'Встреча',date:futureDate,time:'10:00',city:'Красноярск',place:'Парк'});
submit('create',{art:'../../not-an-asset',mode:'OPEN',conditions:''});assert(content().includes('assets/event-art/volleyball.svg'));assert(!content().includes('not-an-asset'));
action('reset');navigate('/events');
for(const match of content().matchAll(/src="(assets\/event-art\/[^"]+)"/g))assert(fs.existsSync(path.join(root,match[1])),match[1]);
console.log('PASS: approved-only organization discovery without membership, preserved cover choice, unknown artwork fallback and existing local files. DOM mocked.');
const snapshots=[];
for(const path of ['/','/events','/orgs','/events/run','/people/anna','/organizations/temp']){navigate(path);snapshots.push({path,html:content()})}
action('login');action('choose-profile',{id:'alex'});navigate('/events/new');snapshots.push({path:'/events/new',html:content()});
for(const route of ['/login','/register','/me','/me/events','/me/organizations','/organizations/new','/me/organizations/rook','/events/tennis/manage']){action('login');action('choose-profile',{id:'anna'});navigate(route);snapshots.push({path:route,html:content()})}
action('login');action('choose-profile',{id:'admin'});
for(const route of ['/admin/organizations','/admin/organizations/rook','/admin/events','/admin/events/tennis']){navigate(route);snapshots.push({path:route,html:content()})}
if(process.env.RYADOM_SNAPSHOT_PATH)fs.writeFileSync(process.env.RYADOM_SNAPSHOT_PATH,JSON.stringify(snapshots));
console.log('PASS: six route templates, filtering/empty result, login, join/request/decision, six event states, guest question preservation, three-step custom-sport creation, unsaved-form warning, reset. DOM mocked; no browser layout verification.');
