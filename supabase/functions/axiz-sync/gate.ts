// Decides what the sync actually stores.
//
// The sync used to write every row the distributor returned and set
// `is_active` to whether it passed the publish gate. That left the database
// holding ~172,000 rows nothing could ever display -- SKUs with no price, no
// image, or a price below the sellable floor -- against ~3,500 that could.
// 406MB of a 456MB database, to describe products that are invisible.
//
// It is not a cache, either. The distributor is the source of truth and the
// full catalogue is re-read every 15 minutes, so a SKU that gains an image
// tomorrow is picked up tomorrow. Storing the failures buys nothing and costs
// the difference between fitting a free database tier and not.
//
// The one thing that genuinely must not be lost: a product that IS live and
// then fails the gate has to be taken down. Skipping it would leave it on the
// storefront forever with stale data -- worse than the disease. So failures
// are not simply dropped: they are deactivated if they already exist, and
// ignored if they do not.

export interface GateableRow {
  sku: string;
  price: number;
  images: string[];
  /** Distributor cost. Zero or missing means Axiz has no price for this SKU. */
  _cost: number;
}

export interface GateResult<T> {
  /** Rows worth writing in full. */
  store: T[];
  /** SKUs to deactivate if they are already in the catalogue -- never inserted. */
  deactivate: string[];
}

/**
 * A row is publishable when the distributor gave us a price, at least one
 * image, and the marked-up price clears the sellable floor.
 *
 * Kept identical to the rule `is_active` was already computed from, so this
 * changes what gets *stored*, never what gets *shown*.
 */
export function isPublishable(row: GateableRow, minSellablePrice: number): boolean {
  return row._cost > 0 && row.images.length > 0 && row.price >= minSellablePrice;
}

export function partitionByGate<T extends GateableRow>(
  rows: T[],
  minSellablePrice: number,
): GateResult<T> {
  const store: T[] = [];
  const deactivate: string[] = [];
  for (const row of rows) {
    if (isPublishable(row, minSellablePrice)) store.push(row);
    else deactivate.push(row.sku);
  }
  return { store, deactivate };
}
