import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { fulfillCase, guestFixtures, httpCase } from '../../../auth/tests/http-fixtures';
import type { components } from '../../../../shared/api/client';
const id = '00000002-0000-4000-8000-000000000001';
const initial = (): components['schemas']['PublishedEventDetail'] => {
  const data = httpCase('getEventSuccess').responseBody as components['schemas']['PublishedEventDetail'];
  return { ...data, id, joinMode: 'OPEN', title: 'Попробуем петанк вместе', startsAt: '2099-11-06T18:00:00Z', description: 'Познакомимся с игрой.', conditions: 'Вода и удобная обувь.', capabilities: { ...data.capabilities, canJoin: false, joinBlockedReason: 'AUTH_REQUIRED' } };
};
async function open(page: Page) {
  await page.goto(`/events/${id}?returnTo=private#discussion`);
  await page.getByRole('button', { name: 'Печатное приглашение', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Печать', exact: true })).toBeEnabled();
}
async function saveQr(page: Page) {
  const url = await page.getByRole('img', { name: 'QR-код ссылки на встречу' }).getAttribute('src');
  fs.mkdirSync('.artifacts/fe17', { recursive: true });
  fs.writeFileSync('.artifacts/fe17/qr.png', Buffer.from(url!.split(',')[1], 'base64'));
}
test.beforeEach(async ({ page }) => {
  await guestFixtures(page);
  await page.addInitScript(() => { (window as unknown as { printCalls: number }).printCalls = 0; window.print = () => { (window as unknown as { printCalls: number }).printCalls++; }; });
});
test('guest OPEN: local QR, zoned time, focus, compact/mobile preview and only the sheet prints', async ({ page }) => {
  let reads = 0; const writes: string[] = [];
  await page.route(`**/api/v1/events/${id}`, (route) => { reads++; return fulfillCase(route, 'getEventSuccess', { responseBody: initial() }); });
  page.on('request', (r) => { if (!['GET','HEAD'].includes(r.method())) writes.push(r.url()); });
  await open(page);
  const dialog = page.getByRole('dialog', { name: 'Печатное приглашение', exact: true });
  await expect(dialog).toContainText('7 ноября 2099 г. в 01:00 GMT+7');
  await expect(dialog).toContainText('Запись подтверждается сразу');
  await expect(dialog.getByRole('link')).toHaveAttribute('href', `http://127.0.0.1:4175/events/${id}`);
  await expect(dialog).toContainText('Адрес доступен только на этом устройстве');
  await saveQr(page);
  for (const width of [320,1280]) {
    await page.setViewportSize({width,height:900});
    expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.screenshot({ path: `.artifacts/fe17/preview-${width}.png`, fullPage:true });
  }
  await page.getByRole('button', { name:'Печать', exact:true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {printCalls:number}).printCalls)).toBe(1);
  expect(reads).toBeGreaterThanOrEqual(3); expect(writes).toEqual([]);
  await page.emulateMedia({media:'print'});
  await expect(page.locator('#root')).toBeHidden();
  await page.pdf({path:'.artifacts/fe17/short.pdf', preferCSSPageSize:true, printBackground:false});
  await page.emulateMedia({media:'screen'}); await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Печатное приглашение',exact:true})).toBeFocused();
  await expect(page.locator('body')).not.toHaveAttribute('data-invitation-active');
});
test('freshness: changed fields require another click, counters do not; withdrawn/read/QR failures clear or block printing', async ({ page }) => {
  let data: components['schemas']['EventDetail'] = initial(); let status = 200;
  await page.route(`**/api/v1/events/${id}`, (route) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)}));
  await open(page);
  data = {...data,conditions:'Обновлённые условия'};
  await page.getByRole('button',{name:'Печать',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Сведения встречи изменились');
  await expect(page.getByRole('button',{name:'Печать',exact:true})).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as {printCalls:number}).printCalls)).toBe(0);
  data = {...data,confirmedCount:999} as components['schemas']['PublishedEventDetail'];
  await page.getByRole('button',{name:'Печать',exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as {printCalls:number}).printCalls)).toBe(1);
  data = {...data,publicationStatus:'UNPUBLISHED'} as unknown as components['schemas']['EventDetail'];
  await page.getByRole('button',{name:'Печать',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('снята с публикации');
  await expect(page.getByRole('article',{name:'Лист приглашения'})).toHaveCount(0);
  status=404; await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('больше недоступна');
  status=200; data={...initial(),capabilities:{...initial().capabilities,joinBlockedReason:'EVENT_STARTED'}};
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('уже началась');
  data=initial();
  await page.evaluate(() => { const proto=HTMLCanvasElement.prototype; (window as unknown as {originalCanvas:typeof proto.toDataURL}).originalCanvas=proto.toDataURL; proto.toDataURL=()=>{throw new Error('test encoder failure');}; });
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Не удалось создать QR-код');
  await expect(page.getByRole('button',{name:'Печать',exact:true})).toBeDisabled();
  await page.evaluate(() => { HTMLCanvasElement.prototype.toDataURL=(window as unknown as {originalCanvas:typeof HTMLCanvasElement.prototype.toDataURL}).originalCanvas; });
  await page.getByRole('button',{name:'Повторить',exact:true}).click();
  await expect(page.getByRole('button',{name:'Печать',exact:true})).toBeEnabled();
});
test('APPROVAL organization and full long conditions print across pages without private fields or clipped text', async ({ page }) => {
  const data=initial();
  data.joinMode='APPROVAL'; data.organizer={type:'ORGANIZATION',organization:{id:'00000003-0000-4000-8000-000000000001',name:'Клуб соседей'},ownerIsBlocked:true};
  data.description='Описание '.repeat(70)+'<не разметка>';
  data.conditions=('Вода, удобная обувь и спокойный темп.\n'.repeat(110)).slice(0,3990)+'КОНЕЦ';
  data.locationText='Точка сбора у входа. '.repeat(49)+'ОРИЕНТИР';
  await page.route(`**/api/v1/events/${id}`,route=>fulfillCase(route,'getEventSuccess',{responseBody:data}));
  await open(page);
  const sheet=page.getByRole('article',{name:'Лист приглашения'});
  await expect(sheet).toContainText('Клуб соседей');
  await expect(sheet).toContainText('отправь заявку и дождись подтверждения');
  await expect(sheet).toContainText('Сейчас он не может рассматривать заявки');
  await expect(sheet).toContainText('Описание сокращено. Полный текст — по ссылке');
  await expect(sheet).toContainText('КОНЕЦ');
  await expect(sheet).not.toContainText('Подтверждённых участников');
  await page.pdf({path:'.artifacts/fe17/long.pdf',preferCSSPageSize:true,printBackground:false});
});
