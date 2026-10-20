import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import accounts from './demo-accounts.json' with { type: 'json' };

function demoDownload(enabled: boolean): Plugin {
  const file = ['Рядом — демонстрационные аккаунты',
    'Публичные вымышленные данные начального набора. Для входа нужен запущенный сервер и явное наполнение seed.',
    'Организациями управляет пользователь Анна; отдельного входа организации нет.',
    'Подставь данные и нажми «Войти». Блокировка Бориса должна запрещать вход.',
    'Состояния меняются после действий. Часть сценариев ещё в разработке.', '',
    ...accounts.flatMap((account) => [
      `${account.name} — ${account.label}`, account.description,
      `Email: ${account.email}`, `Пароль: ${account.password}`, '',
    ]),
  ].join('\n');
  return {
    name: 'ryadom-demo-download',
    configureServer(server) {
      server.middlewares.use('/demo/accounts.txt', (_request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        if (!enabled) { response.statusCode = 404; response.end(); return; }
        response.setHeader('Content-Type', 'text/plain; charset=utf-8');
        response.setHeader('Content-Disposition', 'attachment; filename="ryadom-demo-accounts.txt"');
        response.end(file);
      });
    },
    generateBundle() {
      if (enabled) this.emitFile({ type: 'asset', fileName: 'demo/accounts.txt', source: file });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return { plugins: [react(), demoDownload(env.VITE_DEMO_ACCESS === 'true')] };
});
