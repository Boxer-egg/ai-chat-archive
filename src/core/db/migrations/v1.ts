/** v1：含多账号字段的初版结构（技术方案 §5.4）。在 onupgradeneeded 中调用。 */
import { SCHEMA } from '../schema';

export function migrateV1(db: IDBDatabase): void {
  for (const [storeName, def] of Object.entries(SCHEMA)) {
    const store = db.createObjectStore(storeName, {
      keyPath: def.keyPath ?? undefined,
      autoIncrement: def.autoIncrement ?? false,
    });
    for (const idx of def.indexes) {
      store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
    }
  }
}
