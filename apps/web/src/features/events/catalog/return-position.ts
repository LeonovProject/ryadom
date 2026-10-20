export type CatalogPosition = { url: string; epoch: number; eventId: string; offset: number; link: 'title' | 'action' };

// One position per tab, in memory only. No cards, cursors or account data are retained.
export function createCatalogPositionMemory() {
  let position: CatalogPosition | undefined;
  return {
    save(value: CatalogPosition) { position = { ...value, eventId: value.eventId.toLowerCase() }; },
    read(url: string, epoch: number) { return position?.url === url && position.epoch === epoch ? { ...position } : undefined; },
    clear() { position = undefined; },
  };
}
export const catalogPositionMemory = createCatalogPositionMemory();
