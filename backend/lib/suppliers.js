import { ApiError } from './errors.js';

// Supplier adapter contract:
//   name: string
//   isConfigured(): boolean          true only when credentials exist in process.env
//   fulfill(job): Promise<{ ok: true, supplierRef: string }>
// job = { reference, amount, playerId, extraValue }
// Pass `reference` to the provider as its idempotency key so retries cannot double-deliver.
// Real adapters must read credentials from environment variables, never from source code.

const NONE = {
  name: 'none',
  isConfigured: () => false,
  fulfill: async () => {
    throw new ApiError(409, 'No supplier is configured.');
  },
};

const ADAPTERS = { none: NONE };

export function getSupplier(name) {
  const adapter = ADAPTERS[name];
  if (!adapter) throw new Error(`Unknown SUPPLIER_ADAPTER "${name}". Implement it in lib/suppliers.js first.`);
  return adapter;
}

export function validateSupplierResponse(res) {
  if (!res || res.ok !== true || typeof res.supplierRef !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(res.supplierRef)) {
    throw new Error('Supplier response failed validation.');
  }
  return { supplierRef: res.supplierRef };
}
