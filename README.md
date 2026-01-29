[npm-image]: https://img.shields.io/npm/v/@vlasky/mysql-live-select.svg
[npm-url]: https://npmjs.com/package/@vlasky/mysql-live-select
[downloads-image]: https://img.shields.io/npm/dm/@vlasky/mysql-live-select.svg
[downloads-url]: https://npmjs.com/package/@vlasky/mysql-live-select
[license-url]: https://github.com/vlasky/mysql-live-select/blob/master/LICENSE
[license-image]: https://img.shields.io/npm/l/@vlasky/mysql-live-select.svg?maxAge=2592000

# mysql-live-select

[![NPM Version][npm-image]][npm-url]
[![NPM Downloads][downloads-image]][downloads-url]
[![License][license-image]][license-url]

mysql-live-select emits Node.js events when a MySQL query result set changes.

It works by monitoring table row changes written to the MySQL binary log. Each row change is passed to a user-defined trigger function. When the trigger function returns true, its associated query is re-run and the result set is diffed with the previous result set.

NOTE: This version of mysql-live-select differs from numtel's original package in that result sets are treated as dictionaries rather than arrays. The original package's diffing emits incorrect (with respect to the primary key) events when rows are inserted or deleted at any position other than the end of the array. In this version, the identity of each row is determined by a `LiveMysqlKeySelector` that is passed into the `select` function. The most common use case is `LiveMysqlKeySelector.Columns([primary_key_column])`, which ensures that row insertions and deletions are detected based on the value of `primary_key_column`.

There are other changes and additional features. See below for more details.

Built using vlasky's fork of [`zongji` Binlog Tailer](https://github.com/vlasky/zongji) and [`node-mysql2`](https://github.com/sidorares/node-mysql2).

* [Example Application using Express, SockJS and React](https://github.com/numtel/reactive-mysql-example)
* [Meteor package for reactive MySQL](https://github.com/vlasky/meteor-mysql)
* [NPM Package for Sails.js connection adapter integration](https://github.com/numtel/sails-mysql-live-select)
* [Analogous package for PostgreSQL, `pg-live-select`](https://github.com/numtel/pg-live-select)

This package has been tested to work in MySQL 5.1, 5.5, 5.6, 5.7 and 8. Expected to support all MySQL server versions >= 5.1.15.

## Installation

* **Requires Node.js 18 or later** (ESM-only package)

* **TypeScript support** included via bundled type definitions

* Add the package to your project:
  ```bash
  $ npm install @vlasky/mysql-live-select
  ```

* Enable MySQL binlog in `my.cnf`, restart MySQL server after making the changes.

  ```
  # Must be unique integer from 1-2^32
  server-id        = 1
  # Row format required for ZongJi
  binlog_format    = row
  # Directory must exist. This path works for Linux. Other OS may require
  #   different path.
  log_bin          = /var/log/mysql/mysql-bin.log

  binlog_do_db     = employees   # Optional, limit which databases to log
  expire_logs_days = 10          # Optional, purge old logs
  max_binlog_size  = 100M        # Optional, limit log size
  ```
* Create an account, then grant replication privileges:

  ```sql
  GRANT REPLICATION SLAVE, REPLICATION CLIENT, SELECT ON *.* TO 'user'@'localhost'
  ```

## LiveMysql Constructor

The `LiveMysql` constructor creates up to 3 connections to your MySQL database:

* (When connection pooling is disabled) Connection for executing `SELECT` queries (exposed `node-mysql` instance as `db` property)
* Replication slave connection
* `information_schema` connection for column information

When connection pooling is enabled, additional connections are created as needed. The pool is exposed via the `pool` property (while `db` is undefined).

#### Arguments

Argument | Type | Description
---------|------|---------------------------
`settings` | `object` | An object defining the settings. In addition to the [`node-mysql` connection settings](https://github.com/felixge/node-mysql#connection-options) and [pool settings](https://github.com/felixge/node-mysql#pool-options), the additional settings below are available.
`callback` | `function` | **Deprecated:** callback on connection success/failure. Accepts one argument, `error`. See information below about events emitted.

#### Additional Settings

Setting | Type | Description
--------|------|------------------------------
`serverId`  | `integer` | [Unique number (1 - 2<sup>32</sup>)](http://dev.mysql.com/doc/refman/5.0/en/replication-options.html#option_mysqld_server-id) to identify this replication slave instance. Must be specified if running more than one instance.<br>**Default:** `1`
`pool` | `boolean` | If `true`, `LiveMysql` creates a pool rather than a single connection for `SELECT` queries.
`minInterval` | `integer` | Pass a number of milliseconds to use as the minimum between result set updates. Omit to refresh results on every update. May be changed at runtime.
`checkConditionWhenQueued` | `boolean` | Set to `true` to call the condition function of a query on every binlog row change event. By default (when undefined or `false`), the condition function will not be called again when a query is already queued to be refreshed. Enabling this can be useful if external caching of row changes.

#### Events Emitted

Use `.on(...)` to handle the following event types.

Event Name | Arguments | Description
-----------|-----------|---------------
`error`    | `Error` | An error has occurred.
`ready`    | *None*  | The database connection is ready.

#### Quick Start

```javascript
import LiveMysql, { LiveMysqlKeySelector } from '@vlasky/mysql-live-select';

const settings = {
  host: 'localhost',
  user: 'root',
  password: 'root',
  database: 'mydb',
  serverId: 1,
};

const liveConnection = new LiveMysql(settings);
const id = 11;

liveConnection.on('ready', () => {
  liveConnection.select(
    'SELECT * FROM players WHERE `id` = ?',
    [id],
    LiveMysqlKeySelector.Index(),
    [{
      table: 'players',
      condition: (row, newRow) => {
        // Only refresh the results when the row matching the specified id is changed.
        return row.id === id
          // On UPDATE queries, newRow must be checked as well
          || (newRow && newRow.id === id);
      }
    }]
  ).on('update', (diff, data) => {
    // diff contains an object describing the difference since the previous update
    // data contains a dictionary of rows keyed by the key selector
    console.log(data);
  });
});

liveConnection.on('error', (err) => {
  console.error(err);
});
```


### LiveMysql.select(query, values, keySelector, triggers)

Argument | Type | Description
---------|------|----------------------------------
`query`  | `string` | `SELECT` SQL statement.
`values` | `object` | Placeholder values for `query`. This can be `null` or `undefined`.
`keySelector` | `LiveMysqlKeySelector` | The type of key to use for identifying rows.
`triggers` | `[object]` | Array of objects defining which row changes to update result set.

Returns `LiveMysqlSelect` object.

#### Escaping queries

To manually escape identifiers and strings, call `escape` or `escapeId` in the `LiveMysql` object.

**This should be avoided. Use the `values` parameter instead.**

#### Key selectors

Name | Description
-----|------------------------------
`LiveMysqlKeySelector.Index()` | Uses the row index as the key. This means that the result set is treated as an array.
`LiveMysqlKeySelector.Columns([column1,column2,...])` | Uses one or more columns as the key.
`LiveMysqlKeySelector.Func(keyFunc)` | Uses a function taking `row` and `index` to determine the key for a row.

#### Trigger options

Name | Type | Description
-----|------|------------------------------
`table` | `string` | Name of table (required)
`database` | `string` | Name of database (optional)<br>**Default:** `database` setting specified on connection
`condition` | `function` | Evaluate row values (optional)

#### Condition Function

A condition function accepts up to three arguments:

Argument Name | Description
--------------|-----------------------------
`row`         | Table row data
`newRow`      | New row data (only available on `UPDATE` queries, `null` for others)
`rowDeleted`  | Extra argument for aid in external caching: `true` on `DELETE`  queries, `false` on `INSERT`  queries, `null` on `UPDATE`  queries.

Return `true` when the row data meets the condition to update the result set.

### LiveMysql.pause()

Temporarily skip processing of updates from the binary log.

### LiveMysql.resume()

Begin processing updates after `pause()`. All active live select instances will be refreshed upon resume.

### LiveMysql.end()

Close connections and stop checking for updates.

### LiveMysql.applyDiff(data, diff)

Exposed statically on the LiveMysql object is a function for applying a `diff` given in an `update` event to a dictionary of rows given in the `data` argument.

## LiveMysqlSelect object

Each call to the `select()` method on a LiveMysql object, returns a `LiveMysqlSelect` object with the following methods:

Method Name | Arguments | Description
------------|-----------|-----------------------
`on`, `addListener` | `event`, `handler` | Add an event handler to the result set. See the following section for a list of the available event names.
`invalidate` | *None* | Causes the result set to be updated as soon as possible, but at an unspecified time in the future. When this occurs, the `update` event will be triggered.
`stop` | *None* | Stop receiving updates
`active` | *None* | Return `true` if ready to recieve updates, `false` if `stop()` method has been called.

As well as all of the other methods available on [`EventEmitter`](http://nodejs.org/api/events.html)...

### Available Events

Event Name | Arguments | Description
-----------|-----------|---------------------------
`update` | `diff`, `data` | First argument contains an object describing the difference since the previous `update` event with `added`, `changed`, and `removed` rows. Second argument contains complete result set as a dictionary.
`error` | `error` | Unhandled errors will be thrown

## Running Tests

Tests must be run with a properly configured MySQL server. Configure test settings in `test/settings/mysql.js`.

Execute tests using the `npm test` command.

## License

MIT
