// A small stand-in for Cloudflare D1, backed by Node's built-in SQLite (Node 22.13 or later).
// Used by the local dev server and the tests, so the API runs without Cloudflare tooling.
// It covers only what server/api.js uses: prepare().bind().first()/all()/run() and batch().

export async function createD1(file = ':memory:') {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    return null; // older Node: the API answers that the scoreboard is not set up
  }
  const db = new DatabaseSync(file);
  const statement = (sql) => {
    // D1 compiles a statement only when it runs (a batch can create a table and then index it), so
    // compile lazily here too.
    let compiled = null;
    const st = {
      get: (...a) => (compiled ??= db.prepare(sql)).get(...a),
      all: (...a) => (compiled ??= db.prepare(sql)).all(...a),
      run: (...a) => (compiled ??= db.prepare(sql)).run(...a),
    };
    let args = [];
    const self = {
      bind: (...values) => {
        args = values.map((v) => (typeof v === 'boolean' ? Number(v) : v ?? null));
        return self;
      },
      first: async (column) => {
        const row = st.get(...args);
        if (row == null) return null;
        return column ? row[column] : { ...row };
      },
      all: async () => ({ success: true, results: st.all(...args).map((r) => ({ ...r })) }),
      run: async () => {
        const info = st.run(...args);
        return { success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
      },
    };
    return self;
  };
  return {
    prepare: statement,
    batch: async (statements) => {
      const out = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
    close: () => db.close(),
  };
}
