// Type definitions for @vlasky/mysql-live-select
// Project: https://github.com/vlasky/mysql-live-select

import { EventEmitter } from 'events';
import { Connection, Pool, PoolOptions, ConnectionOptions } from 'mysql2';

/** Generic row data type */
export type RowData = Record<string, unknown>;

/** Data dictionary keyed by row key */
export type DataDictionary<T extends RowData = RowData> = Record<string, T>;

/** Diff object representing changes between two data states */
export interface Diff<T extends RowData = RowData> {
  /** Newly added rows keyed by row key */
  added: DataDictionary<T> | null;
  /** Changed rows with only modified fields */
  changed: Record<string, Partial<T>> | null;
  /** Removed row keys mapped to true */
  removed: Record<string, boolean> | null;
}

/** Table map information from binlog event */
export interface TableMap {
  parentSchema: string;
  tableName: string;
}

/** Binlog row for update events */
export interface UpdateRow<T extends RowData = RowData> {
  before: T;
  after: T;
}

/**
 * Trigger condition function for update events
 * @param before - Row data before update
 * @param after - Row data after update
 * @param isDeleted - Always null for update events
 * @returns true if the trigger should fire
 */
export type UpdateConditionFunction<T extends RowData = RowData> = (
  before: T,
  after: T,
  isDeleted: null
) => boolean;

/**
 * Trigger condition function for insert/delete events
 * @param row - Row data
 * @param unused - Always null
 * @param isDeleted - true if this is a delete event, false for insert
 * @returns true if the trigger should fire
 */
export type WriteDeleteConditionFunction<T extends RowData = RowData> = (
  row: T,
  unused: null,
  isDeleted: boolean
) => boolean;

/** Combined trigger condition function type */
export type TriggerConditionFunction<T extends RowData = RowData> =
  | UpdateConditionFunction<T>
  | WriteDeleteConditionFunction<T>;

/** Trigger definition for monitoring table changes */
export interface Trigger<T extends RowData = RowData> {
  /** Database name (optional, defaults to connection database) */
  database?: string;
  /** Table name to monitor */
  table: string;
  /** Optional condition function to filter which row changes trigger updates */
  condition?: TriggerConditionFunction<T>;
}

/** Key selector function type (returned by LiveMysqlKeySelector methods) */
export type KeySelector = (cases: KeySelectorCases) => unknown;

/** Key function that extracts a unique key from a row */
export type KeyFunction<T extends RowData = RowData> = (row: T, index: number) => string;

/** Internal cases object used by key selectors */
export interface KeySelectorCases {
  index: () => unknown;
  columns: (columnList: string[]) => unknown;
  func: <T extends RowData = RowData>(keyFunc: KeyFunction<T>) => unknown;
}

/** Key selector utility namespace */
export interface LiveMysqlKeySelectorStatic {
  /**
   * Create a key selector that uses array index as the key
   * Note: This treats results as an array, which may cause incorrect diffs
   * for insertions/deletions. Use Columns() instead when possible.
   */
  Index(): KeySelector;

  /**
   * Create a key selector that uses column values as a composite key
   * @param columnList - Array of column names to use as the key
   */
  Columns(columnList: string[]): KeySelector;

  /**
   * Create a key selector that uses a custom function
   * @param keyFunc - Function that returns a unique string key for each row
   */
  Func<T extends RowData = RowData>(keyFunc: KeyFunction<T>): KeySelector;

  /**
   * Create a cache tag string for the given key selector
   * @internal
   */
  makeTag(keySelector: KeySelector): string;

  /**
   * Convert a key selector to a key function
   * @internal
   */
  toKeyFunc<T extends RowData = RowData>(keySelector: KeySelector): KeyFunction<T>;
}

/** Binlog-specific settings extracted from data source settings */
export interface BinlogSettings {
  /** MySQL server ID for binlog replication */
  serverId?: number;
  /** Minimum interval between query re-executions in milliseconds */
  minInterval?: number;
  /** Whether to check trigger conditions even when an update is already queued */
  checkConditionWhenQueued?: boolean;
}

/** Data source settings combining MySQL connection options with binlog settings */
export interface DataSourceSettings extends ConnectionOptions {
  /** Enable connection pooling */
  pool?: boolean;
  /** MySQL server ID for binlog replication */
  serverId?: number;
  /** Minimum interval between query re-executions in milliseconds */
  minInterval?: number;
  /** Whether to check trigger conditions even when an update is already queued */
  checkConditionWhenQueued?: boolean;
}

/** Pool data source settings */
export interface PoolDataSourceSettings extends PoolOptions {
  /** Enable connection pooling (must be true) */
  pool: true;
  /** MySQL server ID for binlog replication */
  serverId?: number;
  /** Minimum interval between query re-executions in milliseconds */
  minInterval?: number;
  /** Whether to check trigger conditions even when an update is already queued */
  checkConditionWhenQueued?: boolean;
}

/** ZongJi settings for binlog monitoring */
export interface ZongJiSettings {
  serverId?: number;
  startAtEnd: boolean;
  includeEvents: string[];
  includeSchema: Record<string, string[]>;
}

/** Events emitted by LiveMysql */
export interface LiveMysqlEvents {
  ready: () => void;
  error: (error: Error) => void;
}

/** Events emitted by LiveMysqlSelect */
export interface LiveMysqlSelectEvents<T extends RowData = RowData> {
  update: (diff: Diff<T>, data: DataDictionary<T>) => void;
  error: (error: Error) => void;
}

/**
 * LiveMysqlSelect - Individual live query subscription
 * Emits 'update' events when the query result set changes
 */
export class LiveMysqlSelect<T extends RowData = RowData> extends EventEmitter {
  /** Array of trigger definitions */
  triggers: Trigger<T>[];
  /** Reference to parent LiveMysql instance */
  base: LiveMysql;
  /** Current result set data */
  data: DataDictionary<T>;
  /** Reference to shared QueryCache */
  queryCache: QueryCache<T>;

  constructor(queryCache: QueryCache<T>, triggers: Trigger<T>[], base: LiveMysql);

  /**
   * Stop this live select and remove it from the parent LiveMysql instance
   * @returns true if successfully removed, false if already stopped
   */
  stop(): boolean;

  /**
   * Check if this live select is still active
   * @returns true if active, false if stopped
   */
  active(): boolean;

  /**
   * Force an immediate refresh of the query results
   */
  invalidate(): void;

  /**
   * Check if a binlog row event matches any of this select's triggers
   * @internal
   */
  matchRowEvent(eventName: string, tableMap: TableMap, rows: RowData[]): boolean;

  // EventEmitter overloads for type safety
  on<K extends keyof LiveMysqlSelectEvents<T>>(
    event: K,
    listener: LiveMysqlSelectEvents<T>[K]
  ): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;

  once<K extends keyof LiveMysqlSelectEvents<T>>(
    event: K,
    listener: LiveMysqlSelectEvents<T>[K]
  ): this;
  once(event: string | symbol, listener: (...args: unknown[]) => void): this;

  emit<K extends keyof LiveMysqlSelectEvents<T>>(
    event: K,
    ...args: Parameters<LiveMysqlSelectEvents<T>[K]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;

  off<K extends keyof LiveMysqlSelectEvents<T>>(
    event: K,
    listener: LiveMysqlSelectEvents<T>[K]
  ): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;

  removeListener<K extends keyof LiveMysqlSelectEvents<T>>(
    event: K,
    listener: LiveMysqlSelectEvents<T>[K]
  ): this;
  removeListener(event: string | symbol, listener: (...args: unknown[]) => void): this;

  addListener<K extends keyof LiveMysqlSelectEvents<T>>(
    event: K,
    listener: LiveMysqlSelectEvents<T>[K]
  ): this;
  addListener(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

/**
 * QueryCache - Caches and deduplicates query results
 * Shared across LiveMysqlSelect instances with identical query/values/keySelector
 */
export class QueryCache<T extends RowData = RowData> {
  /** SQL query string */
  query: string;
  /** Query parameter values */
  values: Record<string, unknown> | undefined;
  /** Cache key string */
  queryCacheKey: string;
  /** Converted key function */
  keyFunc: KeyFunction<T>;
  /** Current result set data */
  data: DataDictionary<T>;
  /** Array of LiveMysqlSelect instances sharing this cache */
  selects: LiveMysqlSelect<T>[];
  /** Whether the query has been executed at least once */
  initialized: boolean;
  /** Minimum interval between query executions in milliseconds */
  minInterval: number | null;
  /** Whether a query update is currently in progress */
  updating: boolean;
  /** Whether another update is needed after the current one completes */
  needUpdate: boolean;
  /** Timestamp of the last update */
  lastUpdate: number;
  /** Pending update timeout handle */
  updateTimeout: ReturnType<typeof setTimeout> | null;
  /** Reference to parent LiveMysql instance */
  base: LiveMysql;

  constructor(
    query: string,
    values: Record<string, unknown> | undefined,
    queryCacheKey: string,
    keySelector: KeySelector,
    minInterval: number | null,
    base: LiveMysql
  );

  /**
   * Set the cached data and propagate to all select instances
   */
  setData(data: DataDictionary<T>): void;

  /**
   * Schedule a query re-execution
   */
  invalidate(): void;

  /**
   * Check if a binlog row event matches any select's triggers
   * @internal
   */
  matchRowEvent(eventName: string, tableMap: TableMap, rows: RowData[]): boolean;
}

/**
 * TableCache - In-memory cache of an entire table
 * Maintains a synchronized copy of table data from binlog events
 */
export class TableCache<T extends RowData = RowData> {
  /** Database schema name */
  schema: string;
  /** Table name */
  table: string;
  /** Primary key column name */
  keyfield: string;
  /** In-memory table data keyed by primary key value */
  cache: DataDictionary<T> | null;
  /** Whether the initial table load has completed */
  initialised: boolean;
  /** Reference to parent LiveMysql instance */
  base: LiveMysql;

  constructor(schema: string, table: string, keyfield: string, base: LiveMysql);

  /**
   * Process a binlog row event and update the cache
   * @internal
   */
  matchRowEvent(eventName: string, tableMap: TableMap, rows: RowData[]): void;
}

/**
 * LiveMysql - Main entry point for mysql-live-select
 * Creates MySQL connections and monitors the binlog for changes
 */
declare class LiveMysql extends EventEmitter {
  /** ZongJi binlog tailer instance */
  zongji: unknown;
  /** MySQL connection pool (if pooling enabled) */
  pool?: Pool;
  /** Promise wrapper for pool */
  poolpromise?: ReturnType<Pool['promise']>;
  /** MySQL connection (if single connection) */
  db?: Connection;
  /** Promise wrapper for db */
  dbpromise?: ReturnType<Connection['promise']>;
  /** MySQL connection/pool settings */
  dataSourceSettings: DataSourceSettings;
  /** Binlog-specific settings */
  binlogSettings: BinlogSettings;
  /** ZongJi configuration settings */
  zongjiSettings: ZongJiSettings;
  /** Whether close was initiated by user */
  userInitiatedClose: boolean;
  /** Number of reconnection attempts */
  reconnectCount: number;
  /** Initialization timeout handle */
  initTimer: ReturnType<typeof setTimeout> | null;

  /** Expose LiveMysqlSelect constructor */
  static LiveMysqlSelect: typeof LiveMysqlSelect;
  /** Expose LiveMysqlKeySelector */
  static LiveMysqlKeySelector: LiveMysqlKeySelectorStatic;
  /** Apply a diff to a data dictionary in-place */
  static applyDiff: typeof applyDiff;

  /**
   * Create a new LiveMysql instance
   * @param dataSourceSettings - MySQL connection settings with optional binlog settings
   * @param callback - Deprecated: Use .on('ready') and .on('error') instead
   */
  constructor(dataSourceSettings: DataSourceSettings | PoolDataSourceSettings, callback?: (error?: Error) => void);

  /**
   * Create a live select query that emits events when results change
   * @param query - SQL SELECT query string
   * @param values - Query parameter values (optional)
   * @param keySelector - Key selector created by LiveMysqlKeySelector methods
   * @param triggers - Array of trigger definitions specifying which tables to monitor
   * @param minInterval - Minimum milliseconds between query re-executions (optional)
   * @returns LiveMysqlSelect instance
   */
  select<T extends RowData = RowData>(
    query: string,
    values: Record<string, unknown> | null | undefined,
    keySelector: KeySelector,
    triggers: Trigger<T>[],
    minInterval?: number
  ): LiveMysqlSelect<T>;

  /**
   * Create a table cache that maintains an in-memory copy of a table
   * @param schema - Database schema name
   * @param table - Table name
   * @param keyfield - Primary key column name
   * @returns TableCache instance
   */
  createTableCache<T extends RowData = RowData>(
    schema: string,
    table: string,
    keyfield: string
  ): TableCache<T>;

  /**
   * Pause binlog monitoring (stops receiving events)
   */
  pause(): void;

  /**
   * Resume binlog monitoring and refresh all queries
   */
  resume(): void;

  /**
   * Close all connections and stop binlog monitoring
   */
  end(): void;

  // EventEmitter overloads for type safety
  on<K extends keyof LiveMysqlEvents>(event: K, listener: LiveMysqlEvents[K]): this;
  on(event: string | symbol, listener: (...args: unknown[]) => void): this;

  once<K extends keyof LiveMysqlEvents>(event: K, listener: LiveMysqlEvents[K]): this;
  once(event: string | symbol, listener: (...args: unknown[]) => void): this;

  emit<K extends keyof LiveMysqlEvents>(
    event: K,
    ...args: Parameters<LiveMysqlEvents[K]>
  ): boolean;
  emit(event: string | symbol, ...args: unknown[]): boolean;

  off<K extends keyof LiveMysqlEvents>(event: K, listener: LiveMysqlEvents[K]): this;
  off(event: string | symbol, listener: (...args: unknown[]) => void): this;

  removeListener<K extends keyof LiveMysqlEvents>(
    event: K,
    listener: LiveMysqlEvents[K]
  ): this;
  removeListener(event: string | symbol, listener: (...args: unknown[]) => void): this;

  addListener<K extends keyof LiveMysqlEvents>(
    event: K,
    listener: LiveMysqlEvents[K]
  ): this;
  addListener(event: string | symbol, listener: (...args: unknown[]) => void): this;
}

/**
 * Compute the difference between two data dictionaries
 * @param oldData - Previous data state
 * @param newData - New data state
 * @returns Diff object with added, changed, and removed entries
 */
export function makeDiff<T extends RowData = RowData>(
  oldData: DataDictionary<T>,
  newData: DataDictionary<T>
): Diff<T>;

/**
 * Apply a diff to a data dictionary in-place
 * @param data - Data dictionary to modify
 * @param diff - Diff object to apply
 */
export function applyDiff<T extends RowData = RowData>(
  data: DataDictionary<T>,
  diff: Diff<T>
): void;

/** LiveMysqlKeySelector static utility object */
export const LiveMysqlKeySelector: LiveMysqlKeySelectorStatic;

export { LiveMysql, QueryCache, TableCache };
export default LiveMysql;
