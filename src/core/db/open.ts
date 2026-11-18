/** IndexedDB 打开与版本升级调度（技术方案 §5.4） */
import { DB_NAME, DB_VERSION } from './schema';
import { migrateV1 } from './migrations/v1';

export type Migrations = Array<(db: IDBDatabase) => void>;
const MIGRATIONS: Migrations = [migrateV1]; // 下标 0 → version 1

let dbPromise: Promise<IDBDatabase> | null = null;
let dbInstance: IDBDatabase | null = null;
let closedByBrowser = false;

export function openDB(): Promise<IDBDatabase> {
  // 自愈：连接被浏览器回收/任何路径关闭后，丢弃缓存重开
  if (dbInstance && closedByBrowser) {
    dbInstance = null;
    dbPromise = null;
  }
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const from = (e as IDBVersionChangeEvent).oldVersion;
      // 注意：迁移函数只用 db（同步建 store/index），旧版本数据迁移在同一事务内进行
      for (let v = from; v < DB_VERSION; v++) MIGRATIONS[v]?.(db);
    };
    req.onsuccess = () => {
      dbInstance = req.result;
      dbInstance.onclose = () => {
        closedByBrowser = true; // MV3 SW 挂起时浏览器会回收连接
      };
      closedByBrowser = false;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('DB blocked by another tab'));
  });
  return dbPromise;
}

/** 测试用：关闭并清空连接缓存（否则 deleteDatabase 会被阻塞） */
export function resetDBCache(): void {
  dbInstance?.close();
  dbInstance = null;
  dbPromise = null;
}

// ---------- 轻量 Promise 封装 ----------

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
