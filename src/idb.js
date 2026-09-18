// 最小限の IndexedDB ラッパー。
// このファイルは「保存先」だけを担当し、ドメインロジックは api.js 側に置く。
// 学習データはこの端末の中だけにあり、外へ送る仕組みは持たない。

// このアプリ専用の保存先。
//
// IndexedDB は「置き場所（パス）」ではなく「配信元（オリジン）」ごとに分かれる。
// 同じ GitHub Pages に別のアプリ（study-todo など）が置いてあると、
// 名前が同じDBは中身まで共有され、覚えのない目標や予定が出てくる。
// アプリごとに違う名前にして、混ざらないようにする。
const DB_NAME = 'study-check';
const DB_VERSION = 1;

export const STORES = {
  questions: 'questions',
  records: 'records',
  tasks: 'tasks',
  challenges: 'challenges',
  goals: 'goals',
  meta: 'meta',
  // 予定を別の日へ動かした記録（繰り越し・予定変更）。学習記録と同じく追加専用で、
  // id で重ね合わせるだけなので、何度読み直しても増えない。
  moves: 'moves',
};

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.questions)) {
        const s = db.createObjectStore(STORES.questions, { keyPath: 'id' });
        s.createIndex('chapter', 'chapter');
        s.createIndex('section', 'section');
        s.createIndex('subject', 'subject');
      }
      if (!db.objectStoreNames.contains(STORES.records)) {
        const s = db.createObjectStore(STORES.records, { keyPath: 'id' });
        s.createIndex('questionId', 'questionId');
        s.createIndex('timestamp', 'timestamp');
        s.createIndex('evaluation', 'evaluation');
      }
      if (!db.objectStoreNames.contains(STORES.tasks)) {
        const s = db.createObjectStore(STORES.tasks, { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains(STORES.challenges)) {
        const s = db.createObjectStore(STORES.challenges, { keyPath: 'id' });
        s.createIndex('timestamp', 'timestamp');
        s.createIndex('taskId', 'taskId');
      }
      if (!db.objectStoreNames.contains(STORES.goals)) {
        db.createObjectStore(STORES.goals, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.moves)) {
        const s = db.createObjectStore(STORES.moves, { keyPath: 'id' });
        s.createIndex('fromDate', 'fromDate');
        s.createIndex('toDate', 'toDate');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
        if (req) {
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } else {
          t.oncomplete = () => resolve();
        }
      })
  );
}

export const idb = {
  /** 記録の削除と、その記録が埋めていた予定の巻き戻しを、1つのまとまりとして行う。 */
  undoAttempt(recordId, update) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction([STORES.records, STORES.tasks], 'readwrite');
      const records = t.objectStore(STORES.records), tasks = t.objectStore(STORES.tasks);
      const requests = [records.get(recordId), records.getAll(), tasks.getAll()];
      let ready = 0, result = { ok: false, error: 'not_found' };
      for (const request of requests) request.onsuccess = () => {
        if (++ready !== requests.length || !requests[0].result) return;
        try {
          const record = requests[0].result;
          const changes = update(record, requests[1].result.filter(r => r.id !== recordId), requests[2].result);
          records.delete(recordId);
          for (const task of changes.tasks) tasks.put(task);
          result = { ok: true, record };
        } catch (error) { t.abort(); reject(error); }
      };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  },
  /** 評価の保存と、使い終わった下書きの片付けを、1つのまとまりとして行う。 */
  commitAttempt(record, expected, nextSession) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction([STORES.records, STORES.meta], 'readwrite');
      let result = { saved: false };
      const meta = t.objectStore(STORES.meta);
      const request = meta.get('session');
      request.onsuccess = () => {
        const current = request.result?.value;
        if (!current?.active || current.sessionId !== expected.sessionId
          || current.currentQuestionId !== expected.currentQuestionId || current.mode !== expected.mode
          || current.currentPlanItemId !== expected.currentPlanItemId) return;
        t.objectStore(STORES.records).put(record);
        meta.put({ key: 'session', value: nextSession });
        result = { saved: true, record };
      };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  },
  /** セッションの読み書きを、タブをまたいでも1つのまとまりとして行う。 */
  updateSession(mutate) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORES.meta, 'readwrite');
      const meta = t.objectStore(STORES.meta);
      const request = meta.get('session');
      let result;
      request.onsuccess = () => {
        try {
          result = mutate(request.result?.value ?? null);
          if (result.session) meta.put({ key: 'session', value: result.session });
        } catch (error) { t.abort(); reject(error); }
      };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  },
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  put: (store, value) => tx(store, 'readwrite', (s) => s.put(value)),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
  byIndex: (store, index, value) =>
    tx(store, 'readonly', (s) => s.index(index).getAll(value)),
  /**
   * 1つの索引にぶら下がるものを、まとめて入れ替える。
   *
   * 消すのと入れるのを別々のトランザクションでやると、その合間に落ちたときに
   * 「消えただけ」の状態が残る。IndexedDB のトランザクションは全部通るか
   * 1つも通らないかのどちらかなので、ここで1つにまとめておく。
   */
  replaceByIndex(store, index, value, values) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, 'readwrite');
          const os = t.objectStore(store);
          const cursorRequest = os.index(index).openCursor(IDBKeyRange.only(value));
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
              return;
            }
            // 消し終わってから入れる。ここまでが同じトランザクションの中。
            values.forEach((v) => os.put(v));
          };
          t.oncomplete = () => resolve(values.length);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  },
  putAll(store, values) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, 'readwrite');
          const os = t.objectStore(store);
          values.forEach((v) => os.put(v));
          t.oncomplete = () => resolve(values.length);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  },
};
