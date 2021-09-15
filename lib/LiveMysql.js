/* mysql-live-select, MIT License github@vladlasky.com, ben@latenightsketches.com, wj32.64@gmail.com
lib/LiveMysql.js - Main class */
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var _ = require('lodash');
var ZongJi = require('@vlasky/zongji');
var mysql = require('mysql2');
var EJSON = require('ejson');

// Maximum duration to wait for Zongji to initialize before timeout error (ms)
var ZONGJI_INIT_TIMEOUT = 10000;
// Time to wait in between reconnect attempts after the first retry (ms)
var ZONGJI_RECONNECT_DELAY = 2000;
// Maximum number of reconnect attempts before emitting an error
var ZONGJI_MAX_RECONNECT_ATTEMPTS = 3;

LiveMysql.prototype.zongjiManager = function(dsn, options, onBinlog) {
  var self=this;
  var newInst = new ZongJi(dsn);

  function onReady() {
    if (self.initTimer) {
      clearTimeout(self.initTimer);
      self.initTimer = null;
    }
    if (self.reconnectCount > 0) console.log("Successfully resumed reading binlog");
    self.reconnectCount = 0;
    self.emit('ready');
  }

  newInst.once('error', function(reason) {
    console.log("ZongJi error:");
    console.log(reason);
    if (self.initTimer) {
      clearTimeout(self.initTimer);
      self.initTimer = null;
    }

    newInst.removeListener('binlog', onBinlog);
    newInst.removeListener('ready', onReady);

    //If it's our first error, attempt to reconnect to the server immediately.
    //Otherwise wait for the ZONGJI_RECONNECT_DELAY period
    //If we are still failing after consecutive ZONGJI_MAX_RECONNECT_ATTEMPTS, emit an error event
    //and don't schedule another reconnect attempt
    let reconnectDelay = (self.reconnectCount === 0) ? 0 : ZONGJI_RECONNECT_DELAY;

    if (self.reconnectCount >= ZONGJI_MAX_RECONNECT_ATTEMPTS) {
      return self.emit('error', new Error('ZONGJI_RECONNECT_FAILURE_OCCURED'));
    }

    console.log("Performing reconnect attempt #" + (self.reconnectCount+1) + " of " + ZONGJI_MAX_RECONNECT_ATTEMPTS + " in " + reconnectDelay + " ms");

    setTimeout(function() {
      // If multiple errors happened, a new instance may have already been created
      if(!('child' in newInst)) {
        let resumeoptions = {};
        if (newInst.options.position && newInst.options.filename) {
          console.log("Attempting to resume reading binlog " + newInst.options.filename + " at position " + newInst.options.position);
          resumeoptions['position'] = newInst.options.position;
          resumeoptions['filename'] = newInst.options.filename;
          resumeoptions['startAtEnd'] = false;
        } else {
          console.log("Attempting to resume reading binlog at end");
        }
        newInst.child = self.zongjiManager(dsn, Object.assign({}, options, resumeoptions), onBinlog);
        newInst.emit('child', newInst.child, reason);
        newInst.child.on('child', child => newInst.emit('child', child, reason));

        self.reconnectCount++;
      }
    }, reconnectDelay);
  });

  newInst.on('ready', onReady);
  newInst.on('binlog', onBinlog);
  newInst.on('child', function(child, reason) {
    newInst.stop();
    self.zongji = child;
  });

  newInst.start(options);
  return newInst;
}

var LiveMysqlSelect = require('./LiveMysqlSelect');
var LiveMysqlKeySelector = require('./LiveMysqlKeySelector');
var QueryCache = require('./QueryCache');
var TableCache = require('./TableCache');

function LiveMysql(settings, callback) {
  var self = this;
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
  if (binlogSetting in settings) {
    self.binlogSettings[binlogSetting] = settings[binlogSetting];
    delete settings[binlogSetting];
    }
  });


  if (settings.pool)
  {
    self.pool = mysql.createPool(settings);
    self.poolpromise = self.pool.promise();
    self.execute = self.pool.execute.bind(self.pool);

    self.endDbOrPool = function() {
      self.pool.end();
    };

    self.initialConnect = process.nextTick;
  }
  else
  {
    self.db = mysql.createConnection(settings);
    self.dbpromise = self.db.promise();
    self.execute = self.db.execute.bind(self.db);

    self.endDbOrPool = function() {
      self.db.destroy();
    };

    self.initialConnect = self.db.connect.bind(self.db);
  }

  self.settings = settings;
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


  self.restart = function() {

    self.initialConnect(function(error) {
      if (error) return self.emit('error', error);

      self.zongji = self.zongjiManager(settings,
        self.zongjiSettings,
        function(binlogEvent) {
          if (binlogEvent.getEventName() === 'tablemap' || 
              binlogEvent.getEventName() === 'rotate') return;

          var eventName = binlogEvent.getEventName();
          var tableMap = binlogEvent.tableMap[binlogEvent.tableId];
          var rows = binlogEvent.rows;

           _.each(self._tableCaches, function(tablecache) {
            tablecache.matchRowEvent(eventName, tableMap, rows);
           });


          _.each(self._queryCache, function(cache) {
            if ((self.settings.checkConditionWhenQueued
                || cache.updateTimeout === null)
                && cache.matchRowEvent(eventName, tableMap, rows)) {
              cache.invalidate();
            }
          });
        });

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
  var self = this;

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
  var includeSchema = self._schemaCache;
  for (var i = 0; i < triggers.length; i++) {
    var triggerDatabase = triggers[i].database || self.settings.database;
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

  var queryCacheKey = EJSON.stringify({
    query: query,
    values: values,
    keySelector: LiveMysqlKeySelector.makeTag(keySelector)
  }, {canonical: true});

  var queryCache;
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

  var newSelect = new LiveMysqlSelect(queryCache, triggers, this);
  self._select.push(newSelect);
  return newSelect;
};

LiveMysql.prototype._removeSelect = function(select) {
  var self = this;
  var index = self._select.indexOf(select);
  if (index !== -1) {
    // Remove the select object from our list
    self._select.splice(index, 1);

    var queryCache = select.queryCache;
    var queryCacheIndex = queryCache.selects.indexOf(select);
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
  var self = this;
  self.zongjiSettings.includeSchema = {};
  self.zongji.start(self.zongjiSettings);
};

LiveMysql.prototype.resume = function() {
  var self = this;
  self.zongjiSettings.includeSchema = self._schemaCache;
  self.zongji.start(self.zongjiSettings);

  // Update all select statements
  _.each(self._queryCache, function(cache) {
    cache.invalidate();
  });
};

LiveMysql.prototype.end = function() {
  var self = this;
  self.userInitiatedClose = true;
  self.zongji.stop();
  self.endDbOrPool();
};

// Expose child constructor for prototype enhancements
LiveMysql.LiveMysqlSelect = LiveMysqlSelect;

// Expose diff apply function statically
LiveMysql.applyDiff = require('./differ').applyDiff;

module.exports = LiveMysql;

LiveMysql.prototype.createTableCache = function(schema, table, keyfield) {
  var self = this;

  if (!(typeof schema === 'string'))
    throw new Error('schema must be a string');
  if (!(typeof table === 'string'))
    throw new Error('table must be a string');
  if (!(typeof keyfield === 'string'))
    throw new Error('keyfield must be a string');

  // Update schema included in ZongJi events
  var includeSchema = self._schemaCache;
  var triggerDatabase = schema || self.settings.database;

  if (triggerDatabase === undefined) {
    throw new Error('no database selected on trigger');
  }

  if (!(triggerDatabase in includeSchema)) {
    includeSchema[triggerDatabase] = [ table ];
  } else if (includeSchema[triggerDatabase].indexOf(table) === -1) {
    includeSchema[triggerDatabase].push(table);
  }

  var newTableCache = new TableCache(schema, table, keyfield, this);
  self._tableCaches.push(newTableCache);
  return newTableCache;
}
