/* mysql-live-select, MIT License ben@latenightsketches.com
   test/index.js - Test Suite */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import _ from 'lodash';
import LiveMysql from '../lib/LiveMysql.js';
import settings from './settings/mysql.js';
import querySequence from './helpers/querySequence.js';
import Connector from './helpers/connector.js';
import * as multipleQueriesData from './fixtures/multipleQueries.js';

const server = new Connector(settings);

// Helper to ensure done() is only called once per test
function onceOnly(fn) {
  let called = false;
  return function(...args) {
    if (!called) {
      called = true;
      fn(...args);
    }
  };
}

beforeEach(() => {
  server.testCount++;
});

afterEach(() => {
  server.closeIfInactive(5000);
});

test('basic', (t, rawDone) => {
  const done = onceOnly(rawDone);
  const table = 'basic';
  //  *  Test that all events emit with correct arguments
  // [1] Test that duplicate queries are cached
  server.once('ready', (conn, esc, escId, queries, KeySelector) => {
    querySequence(conn.db, [
      'DROP TABLE IF EXISTS ' + escId(table),
      'CREATE TABLE ' + escId(table) + ' (col INT UNSIGNED)',
    ], (_results) => {
      queries.splice(0, queries.length);

      const query = 'SELECT * FROM ' + escId(table);
      let conditionCheckIndex = 0;
      const triggers = [{
        database: server.database,
        table: table,
        condition: (row, newRow, isDeleted) => {
          // Ensure that each call of this condition function receives
          // the correct arguments
          conditionCheckIndex++;
          switch(conditionCheckIndex) {
            case 1:
              // Row has been inserted
              assert.strictEqual(row.col, 10);
              assert.strictEqual(newRow, null);
              assert.strictEqual(isDeleted, false);
              break;
            case 2:
              // Row has been updated
              assert.strictEqual(row.col, 10);
              assert.strictEqual(newRow.col, 15);
              assert.strictEqual(isDeleted, null);
              break;
            case 3:
              // Row has been deleted
              assert.strictEqual(row.col, 15);
              assert.strictEqual(newRow, null);
              assert.strictEqual(isDeleted, true);
              break;
          }
          return true;
        }
      }];
      // Second, resultsBuffer check query doesn't need the condition
      const triggersSimple = [{
        database: server.database,
        table: table
      }];

      let testComplete = false;
      const firstSelect = conn.select(query, null, KeySelector.Index(), triggers).on('update', (diff, data) => {
        if (testComplete) return; // Ignore events after test completion
        const dataArray = Object.values(data);
        // After initial update
        if(dataArray.length > 0 && dataArray[0].col === 10){
          // Second select instance to check resultsBuffer
          let secondInstanceInitialized = false;
          conn.select(query, null, KeySelector.Index(), triggersSimple).on('update', (diff, data) => {
            if (testComplete) return;
            const dataArray = Object.values(data);
            if(secondInstanceInitialized === false) {
              // Check that the diff is correct when initializing from cache
              assert.deepStrictEqual(diff.added, { '0': { col: 10 } });
              assert.ok(_.isEmpty(diff.removed));
              secondInstanceInitialized = true;
            }

            if(dataArray.length > 0 && dataArray[0].col === 15){
              // [1] Test in LiveMysqlSelect created later,
              // Ensure only First select, update, second select occurred
              // Along with the INSERT and UPDATE queries, 5 total
              // i.e. No duplicate selects, resultsBuffer working
              assert.strictEqual(queries.length, 5);
              conn.db.query('DELETE FROM ' + escId(table));
            }
          });
        }

        switch(conditionCheckIndex) {
          case 0:
            // Initialized as empty
            assert.strictEqual(dataArray.length, 0);
            assert.ok(_.isEmpty(diff.added));
            assert.strictEqual(diff.removed, null);
            break;
          case 1:
            // Row has been inserted
            assert.strictEqual(dataArray[0].col, 10);
            assert.strictEqual(dataArray.length, 1);
            assert.deepStrictEqual(diff.added, { '0': { col: 10 } });
            break;
          case 2:
            // Row has been updated
            assert.strictEqual(dataArray[0].col, 15);
            assert.strictEqual(dataArray.length, 1);
            // With Index() key selector, the key is the row index, so row 0 is removed and added with new value
            assert.ok(diff.changed && diff.changed['0'] && diff.changed['0'].col === 15);
            break;
          case 3:
            // Row has been deleted
            assert.strictEqual(dataArray.length, 0);
            assert.ok(diff.removed && diff.removed['0']);
            testComplete = true;
            firstSelect.stop();
            done();
            break;
        }
      });

      // Perform database operation sequence
      querySequence(conn.db, [
        'INSERT INTO ' + escId(table) + ' (col) VALUES (10)'
      ], (_results) => {
        // Wait before updating the row
        setTimeout(() => {
          querySequence(conn.db, [
            'UPDATE ' + escId(table) + ' SET `col` = 15'
          ], (_results) => {
            // ...
          });
        }, 100);
      });

    });
  });
});

// Cases specified in test/fixtures/multipleQueries.js
test('multipleQueries', (t, rawDone) => {
  const done = onceOnly(rawDone);
  const tablePrefix = 'multiple_queries_';
  // Milliseconds between each query execution
  const queryWaitTime = 100;
  server.once('ready', (conn, esc, escId, queries, KeySelector) => {
    Object.keys(multipleQueriesData).forEach((queryName) => {
      const table = tablePrefix + queryName;
      const tableEsc = escId(table);
      const details = multipleQueriesData[queryName];

      const columnDefStr = _.map(details.columns, (typeStr, name) => {
        return escId(name) + ' ' + typeStr;
      }).join(', ');
      const columnList = Object.keys(details.columns);
      const initDataStr = details.initial.map((rowData) => {
        return '(' + columnList.map((column) => {
          return esc(rowData[column]);
        }).join(', ') + ')';
      }).join(', ');
      const replaceTable = (query) => {
        return query.replace(/\$table\$/g, tableEsc);
      };
      querySequence(conn.db, [
        'DROP TABLE IF EXISTS ' + tableEsc,
        'CREATE TABLE ' + tableEsc + ' (' + columnDefStr + ')',
        'INSERT INTO ' + tableEsc + ' (' + columnList.map(escId).join(', ') +
          ') VALUES ' + initDataStr,
      ], (_results) => {
        const actualDiffs = [];
        const actualDatas = [];
        let curQuery = 0;
        let oldData = {};
        // Use Columns key selector with 'id' as the key column
        conn.select(replaceTable(details.select), null, KeySelector.Columns(['id']), [{
          table: table,
          database: server.database,
          condition: details.condition
        }]).on('update', (diff, data) => {
          actualDiffs.push(diff);
          const appliedData = _.cloneDeep(oldData);
          LiveMysql.applyDiff(appliedData, diff);
          actualDatas.push(appliedData);

          oldData = _.cloneDeep(data);

          if(curQuery < details.queries.length) {
            setTimeout(() => {
              querySequence(conn.db,
                [replaceTable(details.queries[curQuery++])],
                (_results) => { /* do nothing with results */ });
            }, queryWaitTime);
          }

          if(actualDiffs.length === details.expectedDiffs.length) {
            assert.deepStrictEqual(actualDiffs, details.expectedDiffs,
              'Diff Mismatch on ' + queryName);

            if(details.expectedDatas) {
              assert.deepStrictEqual(actualDatas, details.expectedDatas,
                'Data Mismatch on ' + queryName);
            }
            done();
          }
        });

      });
    });
  });
});

test('checkConditionWhenQueued', (t, rawDone) => {
  const done = onceOnly(rawDone);
  const table = 'check_condition_when_queued';
  server.once('ready', (conn, esc, escId, queries, KeySelector) => {
    // The following line should make no change but it is here for explicitness
    conn.dataSourceSettings.checkConditionWhenQueued = false;

    querySequence(conn.db, [
      'DROP TABLE IF EXISTS ' + escId(table),
      'CREATE TABLE ' + escId(table) + ' (col INT UNSIGNED)',
      'INSERT INTO ' + escId(table) + ' (col) VALUES (10)',
    ], (_results) => {
      let conditionCountUnder1000 = 0;
      let conditionCountOver1000 = 0;
      conn.select('SELECT * FROM ' + escId(table), null, KeySelector.Index(), [{
        table: table,
        database: server.database,
        condition: (row, newRow, _rowDeleted) => {
          if(newRow.col < 1000) {
            // Under 1000, checkConditionWhenQueued is false
            // Will not bother rechecking the condition when query is
            //  queued to be refreshed already
            conditionCountUnder1000++;
          } else {
            // Over 1000, checkConditionWhenQueued is true
            // Condition will be checked with every row that changes
            conditionCountOver1000++;
          }
          return true;
        }
      }]).on('update', (diff, data) => {
        const dataArray = Object.values(data);
        if(dataArray.length > 0 && dataArray[0].col === 2000){
          conn.dataSourceSettings.checkConditionWhenQueued = false;
          assert.strictEqual(conditionCountUnder1000, 1);
          assert.strictEqual(conditionCountOver1000, 4);
          done();
        }
      });

      querySequence(conn.db, [
        'UPDATE ' + escId(table) + ' SET `col` = `col` + 5',
        'UPDATE ' + escId(table) + ' SET `col` = `col` + 5',
        'UPDATE ' + escId(table) + ' SET `col` = `col` + 5',
        'UPDATE ' + escId(table) + ' SET `col` = 1000',
      ], (_results) => {
        // Should have only had one condition function call at this point
        conn.dataSourceSettings.checkConditionWhenQueued = true;

        querySequence(conn.db, [
          'UPDATE ' + escId(table) + ' SET `col` = `col` + 5',
          'UPDATE ' + escId(table) + ' SET `col` = `col` + 5',
          'UPDATE ' + escId(table) + ' SET `col` = `col` + 5',
          'UPDATE ' + escId(table) + ' SET `col` = 2000',
        ], (_results) => {
          // Should have seen all of these updates in condition function
        });
      });
    });
  });
});

test('pauseAndResume', (t, rawDone) => {
  const done = onceOnly(rawDone);
  const waitTime = 500;
  const table = 'pause_resume';
  server.once('ready', (conn, esc, escId, queries, KeySelector) => {
    querySequence(conn.db, [
      'DROP TABLE IF EXISTS ' + escId(table),
      'CREATE TABLE ' + escId(table) + ' (col INT UNSIGNED)',
      'INSERT INTO ' + escId(table) + ' (col) VALUES (10)',
    ], (_results) => {
      let pauseTime = null;
      let testComplete = false;
      const selectObj = conn.select('SELECT * FROM ' + escId(table), null, KeySelector.Index(), [{
        table: table,
        database: server.database
      }]).on('update', (diff, data) => {
        // Guard against events firing after test completion
        if (testComplete) return;
        const dataArray = Object.values(data);
        if(dataArray.length > 0 && dataArray[0].col === 10){
          assert.ok(true);
          pauseTime = Date.now(); // Set pause time when we actually pause
          conn.pause();
          setTimeout(() => {
            if (!testComplete) conn.resume();
          }, waitTime);
        } else if(dataArray.length > 0 && dataArray[0].col === 15 && pauseTime !== null){
          testComplete = true;
          selectObj.removeAllListeners();
          selectObj.stop();
          // Ensure that waiting occurred
          const elapsed = Date.now() - pauseTime;
          assert.ok(elapsed > waitTime, 'Expected elapsed ' + elapsed + ' > waitTime ' + waitTime);
          done();
        }
      });

      querySequence(conn.db, [
        'UPDATE ' + escId(table) + ' SET `col` = 15'
      ], (_results) => {
        // ...
      });
    });
  });
});

test('stopAndActive', (t, rawDone) => {
  const done = onceOnly(rawDone);
  // Test stop() and active() methods on LiveMysqlSelect
  // This test verifies that stopping a select removes it from the query cache

  // Use direct database operations to test stop/active without relying on binlog
  server.once('ready', (conn, esc, escId, queries, KeySelector) => {
    const table = 'stop_active';
    querySequence(conn.db, [
      'DROP TABLE IF EXISTS ' + escId(table),
      'CREATE TABLE ' + escId(table) + ' (col INT UNSIGNED)',
      'INSERT INTO ' + escId(table) + ' (col) VALUES (10)',
    ], (_results) => {
      const query = 'SELECT * FROM ' + escId(table);
      const selectObj = conn.select(query, null, KeySelector.Index(), [{
        table: table,
        database: server.database
      }]);

      // Wait for initial update, then test stop/active
      selectObj.once('update', (diff, data) => {
        const dataArray = Object.values(data);
        assert.strictEqual(dataArray.length, 1);
        assert.strictEqual(dataArray[0].col, 10);

        // Test active() returns true before stop
        assert.ok(selectObj.active());

        // Stop the select
        selectObj.stop();

        // Test active() returns false after stop
        assert.ok(!selectObj.active());

        // Verify query cache is cleaned up
        const cacheKeys = Object.keys(conn._queryCache);
        const found = cacheKeys.some((key) => {
          return key.indexOf(query) !== -1;
        });
        assert.strictEqual(found, false);

        done();
      });
    });
  });
});

test('immediate_disconnection', (t, rawDone) => {
  const done = onceOnly(rawDone);
  let errorOccurred = false;
  // Update serverId setting to prevent collision
  settings.serverId++;

  const myTest = new LiveMysql(settings).on('error', (_error) => {
    errorOccurred = true;
  }).on('ready', () => {
    myTest.end();
    assert.strictEqual(errorOccurred, false);
    settings.serverId--;
    done();
  });
});

test('error_invalid_connection', (t, rawDone) => {
  const done = onceOnly(rawDone);
  new LiveMysql({
    host: '127.0.0.1',
    port: 12345,
    user: 'not-working',
    password: 'hahhaha'
  }).on('error', (error) => {
    assert.strictEqual(error.code, 'ECONNREFUSED');
    done();
  });
});

test('error_invalid_connection_callback', (t, rawDone) => {
  const done = onceOnly(rawDone);
  new LiveMysql({
    host: '127.0.0.1',
    port: 12345,
    user: 'not-working',
    password: 'hahhaha'
  }, (error) => {
    assert.strictEqual(error.code, 'ECONNREFUSED');
    done();
  });
});

test('error_no_db_selected', (t, rawDone) => {
  const done = onceOnly(rawDone);
  server.once('ready', (conn, esc, escId, queries, KeySelector) => {

    assert.throws(() => {
      conn.select('SELECT 1+1', null, KeySelector.Index(), [{ table: 'fake_table' }]);
    }, /no database selected on trigger/);

    assert.throws(() => {
      conn.select('SELECT 1+1', null, KeySelector.Index());
    }, /triggers array required/);

    assert.throws(() => {
      conn.select('SELECT 1+1', null, KeySelector.Index(), []);
    }, /triggers array required/);

    done();
  });
});

test('error_invalid_query', (t, rawDone) => {
  const done = onceOnly(rawDone);
  const table = 'error_invalid_query';
  server.once('ready', (conn, esc, escId, queries, KeySelector) => {
    querySequence(conn.db, [
      'DROP TABLE IF EXISTS ' + escId(table),
      'CREATE TABLE ' + escId(table) + ' (col INT UNSIGNED)',
    ], (_results) => {
      conn.select('SELECT notcol FROM ' + escId(table), null, KeySelector.Index(), [{
        table: table,
        database: server.database
      }]).on('error', (error) => {
        assert.ok(error.toString().match(/ER_BAD_FIELD_ERROR/));
        done();
      });
    });
  });
});
