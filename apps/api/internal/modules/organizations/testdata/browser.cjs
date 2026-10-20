// BE-P1 S1/S2 through shipped forms, actual HTTPS API and three independent roles.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
(async () => {
 const [base, output] = process.argv.slice(2);
 await fs.mkdir(output,{recursive:true});
 const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome',headless:true});
 const errors=[], posts=[];
 async function pageFor(name,password,width=1280) {
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000},timezoneId:'Pacific/Honolulu'});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname)});
  if(name){await page.goto(base+'/login?returnTo=%2Fme');await page.getByLabel(/^Email/).fill(name+'@example.test');await page.getByLabel(/^Пароль/).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForURL(base+'/me');}
  return {page,context};
 }
 const tag=Date.now();
 async function publish(page,title,organization='') {
  await page.goto(base+'/events/new'+(organization?'?organization='+organization:''));
  await page.getByLabel(/^Название встречи/).fill(title);
  await page.getByRole('radio',{name:'Своё направление',exact:true}).check();
  await page.getByLabel(/^Своё направление/).fill('Браузерный спорт '+tag);
  await page.getByLabel(/^Описание встречи/).fill('Знакомимся и пробуем новый спорт вместе.');
  const future=new Date(Date.now()+3*86400000).toISOString().slice(0,16);
  await page.getByLabel(/^Дата и время начала/).fill(future);
  await page.getByLabel(/^Часовая зона встречи/).fill('UTC');
  await page.getByLabel(/^Город/).fill('Красноярск');
  await page.getByLabel(/^Место встречи/).fill('У центрального входа в парк');
  await page.getByRole('button',{name:'Далее: участие',exact:true}).click();
  await page.getByRole('radio',{name:/Свободная запись/}).check();
  await page.getByLabel(/^Условия участия/).fill('Вода и удобная одежда. Можно без опыта.');
  await page.getByRole('button',{name:'Проверить встречу',exact:true}).click();
  await page.getByRole('button',{name:'Опубликовать встречу',exact:true}).click();
  await page.waitForURL(/\/events\/[0-9a-f-]{36}$/);
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  return new URL(page.url()).pathname.split('/').at(-1);
 }
 async function createOrg(page,title) {
  await page.goto(base+'/organizations/new');
  await page.getByLabel(/^Название организации/).fill(title);
  await page.getByLabel(/^Деятельность/).fill('Организуем встречи по спорту для начинающих и старшего поколения.');
  await page.getByLabel(/^Спортивные интересы/).fill('Шахматы, зарядка и бег');
  await page.getByRole('button',{name:'Создать профиль организации',exact:true}).click();
  await page.waitForURL(/\/me\/organizations\/[0-9a-f-]{36}$/);
  await page.getByRole('heading',{name:title,exact:true}).waitFor();
  const id=new URL(page.url()).pathname.split('/').at(-1);
  await page.getByRole('button',{name:'Отправить на проверку',exact:true}).click();
  await page.getByText('Заявка на проверке. Публичная страница и публикация встреч появятся после допуска администратора.',{exact:true}).waitFor();
  return id;
 }
 try {
  const owner=await pageFor('anna','Ryadom-Anna-2026!');
  const reader=await pageFor('alex','Ryadom-Alex-2026!',390);
  const admin=await pageFor('marina','Ryadom-Marina-2026!');
  const personalTitle='Новая встреча S1 '+tag;
  const event=await publish(owner.page,personalTitle);
  await owner.page.screenshot({path:path.join(output,'s1-published-desktop.png'),fullPage:true});
  await reader.page.goto(base+'/events?q='+encodeURIComponent(personalTitle));
  await reader.page.getByRole('link',{name:personalTitle,exact:true}).click();
  await reader.page.getByRole('heading',{name:personalTitle,exact:true}).waitFor();
  assert.equal(new URL(reader.page.url()).pathname,'/events/'+event);
  await reader.page.getByText('Зона встречи: UTC',{exact:true}).waitFor();
  await reader.page.screenshot({path:path.join(output,'s1-second-person-mobile.png'),fullPage:true});
  const approvedTitle='Клуб с допуском '+tag;
  const org=await createOrg(owner.page,approvedTitle);
  assert.equal((await reader.context.request.get(base+'/api/v1/organizations/'+org)).status(),404);
  await owner.page.screenshot({path:path.join(output,'s2-pending-desktop.png'),fullPage:true});
  await admin.page.goto(base+'/admin/organizations/'+org);
  await admin.page.getByRole('heading',{name:approvedTitle,exact:true}).waitFor();
  await admin.page.getByRole('button',{name:'Предоставить допуск',exact:true}).click();
  await admin.page.getByRole('link',{name:'Публичная страница',exact:true}).waitFor();
  await admin.page.screenshot({path:path.join(output,'s2-approved-admin.png'),fullPage:true});
  await owner.page.reload();
  await owner.page.getByRole('link',{name:'Создать встречу от организации',exact:true}).waitFor();
  const organizationTitle='Встреча клуба S2 '+tag;
  const orgEvent=await publish(owner.page,organizationTitle,org);
  await reader.page.goto(base+'/organizations/'+org);
  await reader.page.getByRole('heading',{name:approvedTitle,exact:true}).waitFor();
  await reader.page.getByRole('link',{name:organizationTitle,exact:true}).click();
  await reader.page.getByRole('heading',{name:organizationTitle,exact:true}).waitFor();
  assert.equal(new URL(reader.page.url()).pathname,'/events/'+orgEvent);
  await reader.page.screenshot({path:path.join(output,'s2-club-event-mobile.png'),fullPage:true});
  const rejectedTitle='Клуб с отказом '+tag;
  const rejected=await createOrg(owner.page,rejectedTitle);
  await admin.page.goto(base+'/admin/organizations/'+rejected);
  await admin.page.getByRole('button',{name:'Отклонить',exact:true}).click();
  await admin.page.getByLabel(/^Причина отказа/).fill('Уточните спортивные интересы сообщества.');
  await admin.page.getByRole('button',{name:'Подтвердить отказ',exact:true}).click();
  await admin.page.getByRole('heading',{name:'Причина отказа',exact:true}).waitFor();
  await owner.page.reload();
  await owner.page.getByText('Уточните спортивные интересы сообщества.',{exact:true}).waitFor();
  assert.equal(await owner.page.getByRole('link',{name:'Создать встречу от организации',exact:true}).count(),0);
  assert.equal(await owner.page.getByRole('button',{name:'Отправить на проверку',exact:true}).count(),0);
  await owner.page.setViewportSize({width:390,height:1000});
  await owner.page.screenshot({path:path.join(output,'s2-rejection-owner-mobile.png'),fullPage:true});
  assert.equal((await reader.context.request.get(base+'/api/v1/organizations/'+rejected)).status(),404);
  for(const p of [owner.page,reader.page])assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  assert.deepEqual(errors,[]);
  assert.equal(posts.filter(v=>v==='/api/v1/events').length,2,'unexpected publication retry');
  assert.equal(posts.filter(v=>v==='/api/v1/organizations').length,2,'unexpected organization retry');
  assert.equal(posts.filter(v=>v.endsWith('/application')).length,2,'unexpected submission retry');
  assert.equal(posts.filter(v=>v.endsWith('/decision')).length,2,'unexpected decision retry');
  console.log('PASS browser BE-P1: actual S1/S2 forms, three isolated sessions, new sport, approval/publication, refusal/reason, no automatic retries');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
