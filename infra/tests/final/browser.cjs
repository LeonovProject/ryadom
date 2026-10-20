const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium, expect } = require('@playwright/test');
(async()=>{
 const base=process.argv[2],browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-proxy-server','--host-resolver-rules=MAP ryadom-demo.test 127.0.0.1']});
 const contexts=[];
 async function actor(name,cap){const context=await browser.newContext({viewport:{width:1280,height:950}});contexts.push(context);const page=await context.newPage();await page.goto(base+'/login');await page.getByLabel(/^Email/).fill(name+'@example.test');await page.getByLabel(/^Пароль/).fill('Ryadom-'+cap+'-2026!');await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page).toHaveURL(base+'/');return {page,context};}
 try{
  const anna=await actor('anna','Anna'),admin=await actor('marina','Marina');
  await anna.page.goto(base+'/me');
  const avatar=anna.page.getByRole('region',{name:'Настройка аватара'});
  await expect(avatar.getByRole('button',{name:/Выбрать /})).toHaveCount(7);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e72538"/></svg>';
  await avatar.locator('input[type=file]').setInputFiles({name:'avatar.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await expect(avatar.getByText('Изменение подтверждено сервером.',{exact:true})).toBeVisible();
  await admin.page.goto(base+'/admin/avatars');
  await admin.page.getByRole('button',{name:'Рассмотреть аватар Анна',exact:true}).click();
  await expect(admin.page.getByRole('button',{name:'Одобрить аватар',exact:true})).toBeEnabled();
  await admin.page.getByRole('button',{name:'Одобрить аватар',exact:true}).click();
  await expect(admin.page.getByText('Решение подтверждено сервером.',{exact:true})).toBeVisible();
  await expect(admin.page.getByRole('button',{name:'Скрыть аватар',exact:true})).toBeEnabled();
  await admin.page.getByRole('button',{name:'Скрыть аватар',exact:true}).click();
  await expect(admin.page.getByRole('region',{name:'Выбранный аватар'})).toContainText('Скрыт');
  await expect(admin.page.getByRole('button',{name:'Одобрить аватар',exact:true})).toBeEnabled();
  await admin.page.getByRole('button',{name:'Одобрить аватар',exact:true}).click();
  await expect(admin.page.getByRole('region',{name:'Выбранный аватар'})).toContainText('Одобрен');
  const events=await anna.page.evaluate(async()=>(await (await fetch('/api/v1/events')).json()).items);
  const event=events.find(e=>e.organizer.type==='PERSONAL'&&e.organizer.account.displayName==='Анна'&&Date.parse(e.startsAt)>Date.now());assert(event);
  await anna.page.goto(base+'/events/'+event.id);
  await anna.page.getByLabel('Загрузить фон SVG',{exact:true}).setInputFiles({name:'cover.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await expect(anna.page.getByText('Фон сохранён сервером.',{exact:true})).toBeVisible();
  const detail=await anna.page.evaluate(async id=>(await (await fetch('/api/v1/events/'+id)).json()),event.id);assert(detail.coverUrl);
  await anna.page.getByRole('button',{name:'Печатное приглашение',exact:true}).click();
  await expect(anna.page.getByRole('button',{name:'Печать',exact:true})).toBeEnabled();
  const qr=await anna.page.getByRole('img',{name:'QR-код ссылки на встречу'}).getAttribute('src');assert(qr.startsWith('data:image/png;base64,'));
  await fs.mkdir('/tmp/ryadom-final-evidence',{recursive:true});await fs.writeFile('/tmp/ryadom-final-evidence/qr.png',Buffer.from(qr.split(',')[1],'base64'));
  await fs.writeFile('/tmp/ryadom-final-evidence/expected-url.txt',base+'/events/'+event.id);
  await anna.page.screenshot({path:'/tmp/ryadom-final-evidence/invitation.png',fullPage:true});
  await anna.page.pdf({path:'/tmp/ryadom-final-evidence/invitation.pdf',format:'A4',printBackground:true});
  await anna.page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await anna.page.goto(base+'/me');await anna.page.getByRole('button',{name:'Выбрать Спутник',exact:true}).click();
  await expect(anna.page.getByText('Изменение подтверждено сервером.',{exact:true})).toBeVisible();
  console.log('PASS final real HTTP: seven presets, CUSTOM upload, admin approve/hide/restore, preset replacement, cover upload, invitation fresh preview/PNG QR/A4 PDF');
 }finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
