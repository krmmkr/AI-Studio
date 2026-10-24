import * as duckdb from '@duckdb/duckdb-wasm';

export interface DuckDBQueryResult {
  columns: string[];
  data: Record<string, any>[];
  row_count: number;
  execution_ms: number;
}

class DuckDBWasmService {
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private isInitializing: boolean = false;
  private registeredTables: Set<string> = new Set();

  /**
   * Lazy initialization of DuckDB-WASM with jsDelivr CDN bundles.
   * Runs in a background Web Worker so it never blocks the UI thread.
   */
  async init(): Promise<duckdb.AsyncDuckDB> {
    if (this.db) return this.db;

    if (this.isInitializing) {
      // Poll until initialized
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (this.db) return this.db;
    }

    this.isInitializing = true;
    try {
      const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      const worker = await duckdb.createWorker(bundle.mainWorker!);
      const logger = new duckdb.VoidLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

      this.db = db;
      this.conn = await db.connect();
      return db;
    } catch (err) {
      console.error('Failed to initialize DuckDB-WASM:', err);
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Check if DuckDB-WASM instance is instantiated and ready.
   */
  isReady(): boolean {
    return this.db !== null && this.conn !== null;
  }

  /**
   * Register an in-memory JSON array as a queryable virtual table.
   * Example: registerJson('transactions', [{ id: 1, revenue: 500 }])
   */
  async registerJson(tableName: string, rows: Record<string, any>[]): Promise<void> {
    if (!rows || rows.length === 0) return;
    await this.init();
    if (!this.db || !this.conn) throw new Error('DuckDB-WASM not initialized');

    try {
      const jsonString = JSON.stringify(rows);
      const fileName = `${tableName}.json`;
      await this.db.registerFileText(fileName, jsonString);

      // Create or replace table from JSON file
      await this.conn.query(
        `CREATE OR REPLACE TABLE ${tableName} AS SELECT * FROM read_json_auto('${fileName}');`
      );
      this.registeredTables.add(tableName);
    } catch (err) {
      console.error(`Failed to register table ${tableName} in DuckDB-WASM:`, err);
      throw err;
    }
  }

  /**
   * Register a user-dropped File (CSV or Parquet) into DuckDB-WASM virtual filesystem.
   */
  async registerFile(file: File): Promise<string> {
    await this.init();
    if (!this.db || !this.conn) throw new Error('DuckDB-WASM not initialized');

    const cleanName = file.name.replace(/[^a-zA-Z0-9._]/g, '_');
    const tableName = cleanName.replace(/\.[^/.]+$/, '');
    const buffer = new Uint8Array(await file.arrayBuffer());

    await this.db.registerFileBuffer(cleanName, buffer);

    if (cleanName.endsWith('.parquet')) {
      await this.conn.query(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${cleanName}');`
      );
    } else if (cleanName.endsWith('.csv')) {
      await this.conn.query(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${cleanName}', header=True);`
      );
    } else if (cleanName.endsWith('.json')) {
      await this.conn.query(
        `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_json_auto('${cleanName}');`
      );
    }

    this.registeredTables.add(tableName);
    return tableName;
  }

  /**
   * Execute arbitrary SQL query against DuckDB-WASM.
   * Returns column names, data rows, row count, and execution latency.
   */
  async query(sql: string): Promise<DuckDBQueryResult> {
    await this.init();
    if (!this.conn) throw new Error('DuckDB-WASM connection not available');

    const start = performance.now();
    const result = await this.conn.query(sql);
    const execution_ms = Math.round((performance.now() - start) * 10) / 10;

    const data: Record<string, any>[] = [];
    const schema = result.schema;
    const columns = schema.fields.map((f) => f.name);

    for (const batch of result.batches) {
      for (let i = 0; i < batch.numRows; i++) {
        const row: Record<string, any> = {};
        for (const col of columns) {
          const val = batch.getChild(col)?.get(i);
          // Convert BigInt to Number for JSON serialization
          row[col] = typeof val === 'bigint' ? Number(val) : val;
        }
        data.push(row);
      }
    }

    return {
      columns,
      data,
      row_count: data.length,
      execution_ms,
    };
  }

  /**
   * Get list of currently registered in-memory tables.
   */
  getRegisteredTables(): string[] {
    return Array.from(this.registeredTables);
  }
}

export const duckdbWasm = new DuckDBWasmService();
