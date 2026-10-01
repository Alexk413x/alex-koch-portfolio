/* Loading sql.js and reading a cartographer SQLite file in the browser.

   The vendored sql.js 1.14.1 wasm has no FTS5. SQLite parses a schema
   containing `CREATE VIRTUAL TABLE ... USING fts5` without complaint and only
   errors if something actually queries that table, so every ordinary table
   reads normally.

   The rule that follows: NOTHING here may name `screen_fts`. Search happens in
   JavaScript over rows already loaded. Touching `screen_fts` raises
   "no such module: fts5" and would take the whole page down with it. Its shadow
   tables (`screen_fts_content` and friends) are ordinary tables and are simply
   ignored. */

const VENDOR = new URL('../../vendor/', import.meta.url);

let sqlPromise = null;

/* Load the sql.js runtime once, injecting its classic script tag.
   It is a UMD bundle rather than an ES module, so it cannot be `import`ed;
   loading it here keeps the vendor path relative to this module and lets the
   whole app directory be relocated without editing anything. */
function loadSqlJs() {
  if (sqlPromise) return sqlPromise;
  sqlPromise = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = new URL('sql-wasm.js', VENDOR).href;
    tag.onload = () => {
      if (typeof initSqlJs !== 'function') {
        reject(new Error('sql-wasm.js loaded but did not define initSqlJs'));
        return;
      }
      initSqlJs({ locateFile: f => new URL(f, VENDOR).href }).then(resolve, reject);
    };
    tag.onerror = () => reject(new Error(`could not load ${tag.src}`));
    document.head.appendChild(tag);
  });
  return sqlPromise;
}

/* Fetch a SQLite file over http and open it in memory.
   The whole file is read at once because sql.js has no incremental reader. That
   is right for `baseline.db` at tens to hundreds of kilobytes, and is why a
   `run.db` is only ever opened when its run is actually looked at. */
export async function openDatabase(url) {
  const SQL = await loadSqlJs();
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new SQL.Database(bytes);
}

/* Run a query and return plain objects keyed by column name.
   sql.js hands back parallel columns/values arrays, which is awkward at every
   call site and easy to index wrongly. */
export function rows(db, sql, params = []) {
  const out = [];
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    while (stmt.step()) out.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return out;
}

/* Which tables this file actually has.
   A baseline written by an older schema version may not have all of them, and a
   missing table should degrade one section rather than throw the page away. */
export function tableNames(db) {
  return new Set(
    rows(db, "select name from sqlite_master where type='table'").map(r => r.name)
  );
}

/* Read a whole table, or an empty list if this schema version lacks it.
   `orderBy` is interpolated, so it is only ever called with literals from this
   codebase -- never with anything derived from the data. */
export function readTable(db, present, table, orderBy) {
  if (!present.has(table)) return [];
  const order = orderBy ? ` order by ${orderBy}` : '';
  return rows(db, `select * from "${table}"${order}`);
}

/* The file's `meta` key/value rows as one object.
   Carries `schema_version`, `device_profile`, `platform` and `launch_state`. */
export function readMeta(db, present) {
  const out = {};
  for (const r of readTable(db, present, 'meta', 'key')) out[r.key] = r.value;
  return out;
}
