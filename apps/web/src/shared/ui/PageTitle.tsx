import { useEffect } from 'react';

export function PageTitle({ title }: { title: string }) {
  useEffect(() => { document.title = `${title} — Рядом`; }, [title]);
  return <h1 tabIndex={-1}>{title}</h1>;
}
