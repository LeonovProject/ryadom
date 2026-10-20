import states from '../../../../../brandbook/assets/states.json';
import type { components } from '../api/client';
import styles from './ui.module.css';

// Separate props prevent a participation state from being used as a publication state.
type StatusProps =
  | { domain: 'participation'; status: components['schemas']['ParticipationStatus'] }
  | { domain: 'publication'; status: components['schemas']['PublicationStatus'] }
  | { domain: 'organization'; status: components['schemas']['ApprovalState'] };

const organizationStates = {
  NOT_SUBMITTED: states.organization.draft,
  PENDING: states.organization.pending,
  APPROVED: states.organization.approved,
  REJECTED: states.organization.rejected,
};

export function StatusBadge(props: StatusProps) {
  const state = props.domain === 'organization' ? organizationStates[props.status] : props.domain === 'publication'
    ? states.publication[props.status === 'PUBLISHED' ? 'published' : 'unpublished']
    : states.participation[props.status === 'PENDING' ? 'pending' : props.status === 'CONFIRMED' ? 'confirmed' : 'rejected'];
  return <span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span>;
}
