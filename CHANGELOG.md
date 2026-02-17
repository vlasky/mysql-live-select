# Changelog

All notable changes to this project are documented in this file.

This package is a fork of [numtel/mysql-live-select](https://github.com/numtel/mysql-live-select), diverging at version 1.0.6. It was first published on npm as `@vlasky/mysql-live-select` at version 1.2.10.

## 1.3.0 - 2026-02-13

- Minimum Node.js version is now 18
- Updated @vlasky/zongji to 0.6.0 (ESM, mysql2)
- Updated mysql2 to 3.17.1
- Converted from CommonJS to ES modules
- Converted all classes to ES6 `class` syntax
- Migrated tests from nodeunit to Node.js native test runner
- Removed lodash dependency
- Added Docker Compose configuration and pretest script for test MySQL server

## 1.2.27 - 2024-08-21

- Updated mysql2 to 3.11.0

## 1.2.26 - 2023-02-02

- Updated MySQL dependencies to enable TCP_NODELAY socket option for lower latency on MySQL connections
- Rewrote binlog resume code to be simpler and more robust

## 1.2.25 - 2022-01-28

- Fixed bug where reconnect count was not incremented when timeout callback threw an error, preventing infinite reconnection loop (PR #3 by @n8ores)

## 1.2.24 - 2021-11-24

- Switched back from @vlasky/mysql2 to mysql2 2.3.3
- Fixes to binlog resume code

## 1.2.23 - 2021-11-06

- Temporarily switched to @vlasky/mysql2 for proper data type conversion of prepared statement parameters using type hints from COM_STMT_PREPARE response

## 1.2.22 - 2021-10-19

- Binlog resume fix: close binlog connection immediately on error and establish new connection during reconnection
- Resolves MySQL server error where duplicate server IDs were reported during reconnection

## 1.2.21 - 2021-04-30

- Updated @vlasky/zongji to 0.5.7 with keepalive probe packets on binlog connection
- Fixed `binlogSettings` being unintentionally declared as a global variable

## 1.2.19 - 2021-04-17

- Updated @vlasky/zongji to 0.5.6 for new charset collations in MySQL 8

## 1.2.18 - 2021-04-17

- Updated @vlasky/zongji to 0.5.5 for `caching_sha2_password` authentication plugin support (default in MySQL 8)

## 1.2.17 - 2021-03-24

- Added TableCache for in-memory caching of entire tables via binlog events
- Updated @vlasky/zongji to 0.5.4 for MySQL 8 error code support

## 1.2.16 - 2021-03-20

- Added automatic binlog resume with exponential backoff (max 3 reconnect attempts)
- Fixed `pause()` and `resume()` functions broken by earlier zongji changes
- Rewrote ZONGJI_INIT_TIMEOUT detection for robust operation with binlog resume

## 1.2.15 - 2021-03-08

- Merged binlog resume branch

## 1.2.14 - 2020-11-11

- Maintenance release

## 1.2.13 - 2020-11-11

- Switched to @vlasky/zongji fork

## 1.2.12 - 2020-11-10

- Reverted ES6 import for lodash back to CommonJS for compatibility
- Fixed bug in exception handler

## 1.2.11 - 2020-11-06

- First release as @vlasky/mysql-live-select on npm

## 1.2.10 - 2020-11-05

- Forked and renamed from mysql-live-select to @vlasky/mysql-live-select
- Updated mysql2 to 2.2.5, lodash to 4.17.20
- Fixed bug in `matchRowEvent()` that only ran trigger condition function for the first row in a binlog event; now runs for each row until condition returns true

## 1.2.9 - 2020-04-30

- Added configurable `minInterval` per live query
- Binlog settings are now internally separated from connection settings (no longer passed as second argument)
- Updated mysql2 to 2.1.0
- Added EJSON dependency (PR #1 by @bslocombe)

## 1.2.5 - 2019-11-11

- Updated zongji with support for `binlog_row_image != full`
- Replaced `process.nextTick()` with `setImmediate` for I/O callback priority
- Updated mysql2, zongji, and lodash

## 1.2.4 - 2016-11-10

- Callback is now invoked using `process.nextTick()`
- Callback functions now return their value

## 1.2.3 - 2016-11-04

- Removed event handlers/emitters that belong in the application layer

## 1.2.2 - 2016-10-08

- Updated mysql2 to 1.1.1
- Fixes for MySQL connection pooling

## 1.2.0 - 2016-06-17

- Switched from node-mysql to node-mysql2 for prepared statement support and performance
- Live queries now use `execute()` (prepared statements) instead of `query()`
- Increased ZONGJI_INIT_TIMEOUT from 1500 to 3000 ms

## 1.1.9 - 2016-04-27

- Added `invalidate()` function to LiveMysqlSelect

## 1.1.8 - 2016-04-21

- Updated zongji to 0.4.2, lodash to 4.11.1
- Fixed invalidation scheduling logic

## 1.1.4 - 2015-12-22

- Initial fork from numtel/mysql-live-select
- Result sets treated as dictionaries keyed by `LiveMysqlKeySelector` instead of arrays
- Added key selector strategies: `Index()`, `Columns()`, `Func()`
- Added EJSON-based query cache keying
- Added support for placeholder values and connection pools
