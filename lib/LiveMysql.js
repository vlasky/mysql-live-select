/* mysql-live-select, MIT License github@vladlasky.com, ben@latenightsketches.com, wj32.64@gmail.com
lib/LiveMysql.js - Main class */
import { EventEmitter } from 'events';
import _ from 'lodash';
import ZongJi from '@vlasky/zongji';
import mysql from 'mysql2';
import EJSON from 'ejson';

import LiveMysqlSelect from './LiveMysqlSelect.js';
import LiveMysqlKeySelector from './LiveMysqlKeySelector.js';
import QueryCache from './QueryCache.js';
import TableCache from './TableCache.js';
import { applyDiff } from './differ.js';

// Maximum duration to wait for Zongji to initialize before timeout error (ms)
const ZONGJI_INIT_TIMEOUT = 10000;
// Time to wait in between reconnect attempts after the first retry (ms)
const ZONGJI_RECONNECT_DELAY = 2000;
// Maximum number of reconnect attempts before emitting an error
const ZONGJI_MAX_RECONNECT_ATTEMPTS = 3;

class LiveMysql extends EventEmitter {
  // Expose child constructor for prototype enhancements
  static LiveMysqlSelect = LiveMysqlSelect;

  // Expose key selector
  static LiveMysqlKeySelector = LiveMysqlKeySelector;

  // Expose diff apply function statically
  static applyDiff = applyDiff;

  constructor(dataSourceSettings, callback) {
    super();

    if (callback) {
      console.warn(
        '\nWARNING: Callback on LiveMysql constructor deprecated! \n' +
        '  Use .on() \'error\' and \'ready\' instead.');
      this.on('error', callback);
      this.on('ready', callback);
    }

    this.userInitiatedClose = false;

    this.reconnectCount = 0;
    this.initTimer = null;

    //node-mysql2 complains if it sees settings that it is unfamiliar with, so we will separate them out into binlogSettings.
    this.binlogSettings = {};
    const binlogSettingsList = ['serverId', 'minInterval', 'checkConditionWhenQueued'];

    binlogSettingsList.forEach(binlogSetting => {
      if (binlogSetting in dataSourceSettings) {
        this.binlogSettings[binlogSetting] = dataSourceSettings[binlogSetting];
        delete dataSourceSettings[binlogSetting];
      }
    });

    if (dataSourceSettings.pool) {
      this.pool = mysql.createPool(dataSourceSettings);
      this.poolpromise = this.pool.promise();
      this.execute = this.pool.execute.bind(this.pool);

      this.endDbOrPool = () => {
        this.pool.end();
      };

      this.initialConnect = process.nextTick;
    } else {
      this.db = mysql.createConnection(dataSourceSettings);
      this.dbpromise = this.db.promise();
      this.execute = this.db.execute.bind(this.db);

      this.endDbOrPool = () => {
        this.db.destroy();
      };

      this.initialConnect = this.db.connect.bind(this.db);
    }

    this.dataSourceSettings = dataSourceSettings;
    this.zongji = null;
    /** @type {LiveMysqlSelect[]} */
    this._select = [];
    /** @type {Object<string, QueryCache>} */
    this._queryCache = {};
    /** @type {Object<string, string[]>} */
    this._schemaCache = {};
    /** @type {TableCache[]} */
    this._tableCaches = [];

    this.zongjiSettings = {
      serverId: this.binlogSettings.serverId,
      startAtEnd: true,
      includeEvents: [ 'tablemap', 'rotate', 'writerows', 'updaterows', 'deleterows' ],
      includeSchema: this._schemaCache
    };

    this.onBinlog = (binlogEvent) => {
      if (binlogEvent.getEventName() === 'tablemap' ||
          binlogEvent.getEventName() === 'rotate') return;

      const eventName = binlogEvent.getEventName();
      const tableMap = binlogEvent.tableMap[binlogEvent.tableId];
      const rows = binlogEvent.rows;

      _.each(this._tableCaches, (tablecache) => {
        tablecache.matchRowEvent(eventName, tableMap, rows);
      });

      _.each(this._queryCache, (cache) => {
        if ((this.dataSourceSettings.checkConditionWhenQueued
            || cache.updateTimeout === null)
            && cache.matchRowEvent(eventName, tableMap, rows)) {
          cache.invalidate();
        }
      });
    };

    this.restart();
  }

  restart() {
    this.initialConnect((error) => {
      if (error) return this.emit('error', error);

      this.initZongji(this.zongjiSettings);

      if (this.initTimer) clearTimeout(this.initTimer);
      this.initTimer = setTimeout(() => {
        this.emit('error', new Error('ZONGJI_INIT_TIMEOUT_OCCURED'));
        this.initTimer = null;
      }, ZONGJI_INIT_TIMEOUT);
    });
  }

  initZongji(options) {
    this.zongji = new ZongJi(this.dataSourceSettings);

    this.zongji.once('ready', () => {
      if (this.initTimer) {
        clearTimeout(this.initTimer);
        this.initTimer = null;
      }
      if (this.reconnectCount > 0) console.log("Successfully resumed reading binlog");
      this.reconnectCount = 0;
      this.emit('ready');
    });

    this.zongji.on('binlog', this.onBinlog);

    this.zongji.once('error', (reason) => {
      console.log("ZongJi error:");
      console.log(reason);

      if (this.initTimer) {
        clearTimeout(this.initTimer);
        this.initTimer = null;
      }
      this.zongji.stop();
      this.zongji.removeListener('binlog', this.onBinlog);

      //If it's our first error, attempt to reconnect to the server immediately.
      //Otherwise wait for the ZONGJI_RECONNECT_DELAY period
      //If we are still failing after consecutive ZONGJI_MAX_RECONNECT_ATTEMPTS, emit an error event
      //and don't schedule another reconnect attempt
      let reconnectDelay = (this.reconnectCount === 0) ? 0 : ZONGJI_RECONNECT_DELAY;

      if (this.reconnectCount >= ZONGJI_MAX_RECONNECT_ATTEMPTS) {
        return this.emit('error', new Error('ZONGJI_RECONNECT_FAILURE_OCCURED'));
      }

      console.log(`Performing reconnect attempt #${this.reconnectCount+1} of ${ZONGJI_MAX_RECONNECT_ATTEMPTS} in ${reconnectDelay} ms`);

      //After the reconnect delay period has elapsed, initialise a new ZongJi instance, resuming at the last recorded position in the binlog
      setTimeout(() => {
        this.reconnectCount++;

        let resumeoptions = {};
        if (this.zongji.options.position && this.zongji.options.filename) {
          console.log(`Attempting to resume reading binlog ${this.zongji.options.filename} at position ${this.zongji.options.position}`);
          resumeoptions['position'] = this.zongji.options.position;
          resumeoptions['filename'] = this.zongji.options.filename;
          resumeoptions['startAtEnd'] = false;
        } else {
          console.log("Attempting to resume reading binlog at end");
        }

        this.initZongji(Object.assign({}, options, resumeoptions));

      }, reconnectDelay);
    });

    this.zongji.start(options);
  }

  select(query, values, keySelector, triggers, minInterval) {
    if (!(typeof query === 'string'))
      throw new Error('query must be a string');
    if (!(typeof values === 'object' || values === undefined))
      throw new Error('values must be an object, null, or undefined');
    if (!(keySelector instanceof Function))
      throw new Error('keySelector required');
    if (!(triggers instanceof Array) || triggers.length === 0)
      throw new Error('triggers array required');
    if (!(typeof minInterval === 'number' || minInterval === undefined))
      throw new Error('minInterval must be a number or undefined');

    // Update schema included in ZongJi events
    const includeSchema = this._schemaCache;
    for (let i = 0; i < triggers.length; i++) {
      const triggerDatabase = triggers[i].database || this.dataSourceSettings.database;
      if (triggerDatabase === undefined) {
        throw new Error('no database selected on trigger');
      }
      if (!(triggerDatabase in includeSchema)) {
        includeSchema[triggerDatabase] = [ triggers[i].table ];
      } else if (includeSchema[triggerDatabase].indexOf(triggers[i].table) === -1) {
        includeSchema[triggerDatabase].push(triggers[i].table);
      }
    }

    // node-mysql seems to expect undefined rather than null
    if (values === null)
      values = undefined;

    const queryCacheKey = EJSON.stringify({
      query: query,
      values: values,
      keySelector: LiveMysqlKeySelector.makeTag(keySelector)
    }, {canonical: true});

    let queryCache;
    if (queryCacheKey in this._queryCache) {
      queryCache = this._queryCache[queryCacheKey];
    } else {
      if (minInterval === undefined) {
        if (typeof this.binlogSettings.minInterval === 'number') {
          minInterval = this.binlogSettings.minInterval;
        } else {
          minInterval = null;
        }
      }
      queryCache = new QueryCache(query, values, queryCacheKey, keySelector, minInterval, this);
      this._queryCache[queryCacheKey] = queryCache;
    }

    const newSelect = new LiveMysqlSelect(queryCache, triggers, this);
    this._select.push(newSelect);
    return newSelect;
  }

  _removeSelect(select) {
    const index = this._select.indexOf(select);
    if (index !== -1) {
      // Remove the select object from our list
      this._select.splice(index, 1);

      const queryCache = select.queryCache;
      const queryCacheIndex = queryCache.selects.indexOf(select);
      if (queryCacheIndex !== -1) {
        // Remove the select object from the query cache's list and remove the
        // query cache if no select objects are using it.
        queryCache.selects.splice(queryCacheIndex, 1);
        if (queryCache.selects.length === 0) {
          delete this._queryCache[queryCache.queryCacheKey];
        }
      }

      return true;
    } else {
      return false;
    }
  }

  pause() {
    this.zongjiSettings.includeSchema = {};
    this.zongji.start(this.zongjiSettings);
  }

  resume() {
    this.zongjiSettings.includeSchema = this._schemaCache;
    this.zongji.start(this.zongjiSettings);

    // Update all select statements
    _.each(this._queryCache, (cache) => {
      cache.invalidate();
    });
  }

  end() {
    this.userInitiatedClose = true;
    this.zongji.stop();
    this.endDbOrPool();
  }

  createTableCache(schema, table, keyfield) {
    if (!(typeof schema === 'string'))
      throw new Error('schema must be a string');
    if (!(typeof table === 'string'))
      throw new Error('table must be a string');
    if (!(typeof keyfield === 'string'))
      throw new Error('keyfield must be a string');

    // Update schema included in ZongJi events
    const includeSchema = this._schemaCache;
    const triggerDatabase = schema || this.dataSourceSettings.database;

    if (triggerDatabase === undefined) {
      throw new Error('no database selected on trigger');
    }

    if (!(triggerDatabase in includeSchema)) {
      includeSchema[triggerDatabase] = [ table ];
    } else if (includeSchema[triggerDatabase].indexOf(table) === -1) {
      includeSchema[triggerDatabase].push(table);
    }

    const newTableCache = new TableCache(schema, table, keyfield, this);
    this._tableCaches.push(newTableCache);
    return newTableCache;
  }
}

export default LiveMysql;
export { LiveMysqlSelect, LiveMysqlKeySelector, QueryCache, TableCache, applyDiff };
