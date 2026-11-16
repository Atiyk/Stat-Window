import { inventoryDays } from '../content/inventory';
import type { SurvivalCatalog } from './catalog';
import { eligiblePool, supplyOf, type PoolEntry, type Supply } from './pool';

/** Loads the catalog (its own chunk) and works out the pool for a UTC day. */
export async function loadPool(day: string): Promise<{ catalog: SurvivalCatalog; pool: PoolEntry[]; supply: Supply }> {
  const catalog = (await import('../../content/survival/catalog.json')).default as unknown as SurvivalCatalog;
  const pool = eligiblePool(catalog, day, inventoryDays);
  return { catalog, pool, supply: supplyOf(pool, day) };
}
