import accounts from '../../../demo-accounts.json';

// Public fictional seed credentials. Disabled builds omit both data and download.
export const demoAccessEnabled = import.meta.env.VITE_DEMO_ACCESS === 'true';
export const demoAccounts = demoAccessEnabled ? accounts : [];
export type DemoAccount = (typeof accounts)[number];

export function findDemoAccount(key: unknown): DemoAccount | undefined {
  return typeof key === 'string' ? demoAccounts.find((account) => account.key === key) : undefined;
}
