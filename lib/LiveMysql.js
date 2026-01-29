/* mysql-live-select, MIT License github@vladlasky.com, ben@latenightsketches.com, wj32.64@gmail.com
lib/LiveMysql.js - Main class */
import { EventEmitter } from 'events';
import util from 'util';
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

LiveMysql.prototype.initZongji = function(options) {
  const self = this;
  self.zongji = new ZongJi(self.dataSourceSettings);

  self.zongji.once('ready', function() {
    if (self.initTimer) {
      clearTimeout(self.initTimer);
      self.initTimer = null;
    }
    if (self.reconnectCount > 0) console.log("Successfully resumed reading binlog");
    self.reconnectCount = 0;
    self.emit('ready');
  });

  self.zongji.on('binlog', self.onBinlog);

  self.zongji.once('error', function(reason) {
    console.log("ZongJi error:");
    console.log(reason);

    if (self.initTimer) {
      clearTimeout(self.initTimer);
      self.initTimer = null;
    }
    self.zongji.stop();
    self.zongji.removeListener('binlog', self.onBinlog);

    //If it's our first error, attempt to reconnect to the server immediately.
    //Otherwise wait for the ZONGJI_RECONNECT_DELAY period
    //If we are still failing after consecutive ZONGJI_MAX_RECONNECT_ATTEMPTS, emit an error event
    //and don't schedule another reconnect attempt
    let reconnectDelay = (self.reconnectCount === 0) ? 0 : ZONGJI_RECONNECT_DELAY;

    if (self.reconnectCount >= ZONGJI_MAX_RECONNECT_ATTEMPTS) {
      return self.emit('error', new Error('ZONGJI_RECONNECT_FAILURE_OCCURED'));
    }

    console.log(`Performing reconnect attempt #${self.reconnectCount+1} of ${ZONGJI_MAX_RECONNECT_ATTEMPTS} in ${reconnectDelay} ms`);

    //After the reconnect delay period has elapsed, initialise a new ZongJi instance, resuming at the last recorded position in the binlog
    setTimeout(function() {
      self.reconnectCount++;

      let resumeoptions = {};
      if (self.zongji.options.position && self.zongji.options.filename) {
        console.log(`Attempting to resume reading binlog ${self.zongji.options.filename} at position ${self.zongji.options.position}`);
        resumeoptions['position'] = self.zongji.options.position;
        resumeoptions['filename'] = self.zongji.options.filename;
        resumeoptions['startAtEnd'] = false;
      } else {
        console.log("Attempting to resume reading binlog at end");
      }

      self.initZongji(Object.assign({}, options, resumeoptions));

    }, reconnectDelay);
  });

  self.zongji.start(options);
}

function LiveMysql(dataSourceSettings, callback) {
  const self = this;
  EventEmitter.call(this);

  if (callback) {
    console.warn(
      '\nWARNING: Callback on LiveMysql constructor deprecated! \n' +
      '  Use .on() \'error\' and \'ready\' instead.');
    self.on('error', callback);
    self.on('ready', callback);
  }

  self.userInitiatedClose = false;

  self.reconnectCount = 0;
  self.initTimer = null;

  //node-mysql2 complains if it sees settings that it is unfamiliar with, so we will separate them out into binlogSettings.
  self.binlogSettings = {};
  const binlogSettingsList = ['serverId', 'minInterval', 'checkConditionWhenQueued'];

  binlogSettingsList.forEach(binlogSetting => {
    if (binlogSetting in dataSourceSettings) {
      self.binlogSettings[binlogSetting] = dataSourceSettings[binlogSetting];
      delete dataSourceSettings[binlogSetting];
    }
  });

  if (dataSourceSettings.pool) {
    self.pool = mysql.createPool(dataSourceSettings);
    self.poolpromise = self.pool.promise();
    self.execute = self.pool.execute.bind(self.pool);

    self.endDbOrPool = function() {
      self.pool.end();
    };

    self.initialConnect = process.nextTick;
  } else {
    self.db = mysql.createConnection(dataSourceSettings);
    self.dbpromise = self.db.promise();
    self.execute = self.db.execute.bind(self.db);

    self.endDbOrPool = function() {
      self.db.destroy();
    };

    self.initialConnect = self.db.connect.bind(self.db);
  }

  self.dataSourceSettings = dataSourceSettings;
  self.zongji = null;
  self._select = [];
  self._queryCache = {};
  self._schemaCache = {};

  self._tableCaches = [];

  self.zongjiSettings = {
    serverId: self.binlogSettings.serverId,
    startAtEnd: true,
    includeEvents: [ 'tablemap', 'rotate', 'writerows', 'updaterows', 'deleterows' ],
    includeSchema: self._schemaCache
  };


  self.onBinlog = function(binlogEvent) {
    if (binlogEvent.getEventName() === 'tablemap' ||
        binlogEvent.getEventName() === 'rotate') return;

    const eventName = binlogEvent.getEventName();
    const tableMap = binlogEvent.tableMap[binlogEvent.tableId];
    const rows = binlogEvent.rows;

    _.each(self._tableCaches, function(tablecache) {
      tablecache.matchRowEvent(eventName, tableMap, rows);
    });


    _.each(self._queryCache, function(cache) {
      if ((self.dataSourceSettings.checkConditionWhenQueued
          || cache.updateTimeout === null)
          && cache.matchRowEvent(eventName, tableMap, rows)) {
        cache.invalidate();
      }
    });
  }

  self.restart = function() {

    self.initialConnect(function(error) {
      if (error) return self.emit('error', error);

      self.initZongji(self.zongjiSettings);

        if (self.initTimer) clearTimeout(self.initTimer);
        self.initTimer = setTimeout(function() {
          self.emit('error', new Error('ZONGJI_INIT_TIMEOUT_OCCURED'));
          self.initTimer = null;
        }, ZONGJI_INIT_TIMEOUT);
    });
  }
  self.restart();
}

util.inherits(LiveMysql, EventEmitter);

LiveMysql.prototype.select = function(query, values, keySelector, triggers, minInterval) {
  const self = this;

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
  const includeSchema = self._schemaCache;
  for (let i = 0; i < triggers.length; i++) {
    const triggerDatabase = triggers[i].database || self.dataSourceSettings.database;
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
  if (queryCacheKey in self._queryCache) {
    queryCache = self._queryCache[queryCacheKey];
  } else {
    if (minInterval === undefined) {
      if (typeof this.binlogSettings.minInterval === 'number') {
        minInterval = this.binlogSettings.minInterval;
      } else {
        minInterval = null;
      }
    }
    queryCache = new QueryCache(query, values, queryCacheKey, keySelector, minInterval, this);
    self._queryCache[queryCacheKey] = queryCache;
  }

  const newSelect = new LiveMysqlSelect(queryCache, triggers, this);
  self._select.push(newSelect);
  return newSelect;
};

LiveMysql.prototype._removeSelect = function(select) {
  const self = this;
  const index = self._select.indexOf(select);
  if (index !== -1) {
    // Remove the select object from our list
    self._select.splice(index, 1);

    const queryCache = select.queryCache;
    const queryCacheIndex = queryCache.selects.indexOf(select);
    if (queryCacheIndex !== -1) {
      // Remove the select object from the query cache's list and remove the
      // query cache if no select objects are using it.
      queryCache.selects.splice(queryCacheIndex, 1);
      if (queryCache.selects.length === 0) {
        delete self._queryCache[queryCache.queryCacheKey];
      }
    }

    return true;
  } else {
    return false;
  }
}

LiveMysql.prototype.pause = function() {
  const self = this;
  self.zongjiSettings.includeSchema = {};
  self.zongji.start(self.zongjiSettings);
};

LiveMysql.prototype.resume = function() {
  const self = this;
  self.zongjiSettings.includeSchema = self._schemaCache;
  self.zongji.start(self.zongjiSettings);

  // Update all select statements
  _.each(self._queryCache, function(cache) {
    cache.invalidate();
  });
};

LiveMysql.prototype.end = function() {
  const self = this;
  self.userInitiatedClose = true;
  self.zongji.stop();
  self.endDbOrPool();
};

LiveMysql.prototype.createTableCache = function(schema, table, keyfield) {
  const self = this;

  if (!(typeof schema === 'string'))
    throw new Error('schema must be a string');
  if (!(typeof table === 'string'))
    throw new Error('table must be a string');
  if (!(typeof keyfield === 'string'))
    throw new Error('keyfield must be a string');

  // Update schema included in ZongJi events
  const includeSchema = self._schemaCache;
  const triggerDatabase = schema || self.dataSourceSettings.database;

  if (triggerDatabase === undefined) {
    throw new Error('no database selected on trigger');
  }

  if (!(triggerDatabase in includeSchema)) {
    includeSchema[triggerDatabase] = [ table ];
  } else if (includeSchema[triggerDatabase].indexOf(table) === -1) {
    includeSchema[triggerDatabase].push(table);
  }

  const newTableCache = new TableCache(schema, table, keyfield, this);
  self._tableCaches.push(newTableCache);
  return newTableCache;
}

// Expose child constructor for prototype enhancements
LiveMysql.LiveMysqlSelect = LiveMysqlSelect;

// Expose key selector
LiveMysql.LiveMysqlKeySelector = LiveMysqlKeySelector;

// Expose diff apply function statically
LiveMysql.applyDiff = applyDiff;

export default LiveMysql;
export { LiveMysqlSelect, LiveMysqlKeySelector, QueryCache, TableCache, applyDiff };
