import { Button } from '../../shared/ui/Button';
import { demoAccounts, type DemoAccount } from './demo-access';
import styles from './demo.module.css';

export function DemoAccountPicker({ onSelect, disabled }: { onSelect: (account: DemoAccount) => void; disabled: boolean }) {
  return <details className={styles.picker}>
    <summary>Выбрать демоаккаунт</summary>
    <p>Выбор заполнит email и пароль. Для входа нажми «Войти».</p>
    <ul className={styles.list}>
      {demoAccounts.map((account) => <li key={account.key} className={styles.choice}>
        <div><strong>{account.name}</strong><p>{account.label}</p></div>
        <Button variant="secondary" disabled={disabled} aria-label={`Подставить данные: ${account.name}`} onClick={() => onSelect(account)}>Подставить данные</Button>
      </li>)}
    </ul>
  </details>;
}
