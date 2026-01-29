/* mysql-live-select, MIT License ben@latenightsketches.com
   lib/LiveMysqlSelect.js - Select result set class */
import { EventEmitter } from 'events';
import util from 'util';

function LiveMysqlSelect(queryCache, triggers, base) {
  if (!queryCache)
    throw new Error('queryCache required');
  if (!(triggers instanceof Array))
    throw new Error('triggers array required');
  if (typeof base !== 'object')
    throw new Error('base LiveMysql instance required');

  const self = this;
  EventEmitter.call(self);
  self.triggers = triggers;
  self.base = base;
  self.data = {};
  self.queryCache = queryCache;
  queryCache.selects.push(self);

  if (queryCache.initialized) {
    const refLastUpdate = queryCache.lastUpdate;

    // Trigger events for existing data
    setImmediate(function() {
      if (queryCache.lastUpdate !== refLastUpdate) {
        // Query cache has been updated since this select object was created;
        // our data would've been updated already.
        return;
      }

      self.emit('update',
        { added: queryCache.data, changed: null, removed: null },
        queryCache.data);
    });
  } else {
    queryCache.invalidate();
  }
}

util.inherits(LiveMysqlSelect, EventEmitter);

LiveMysqlSelect.prototype.matchRowEvent = function(eventName, tableMap, rows) {
  const self = this;
  let trigger, row, rowDeleted, triggerDatabase;
  for (let i = 0; i < self.triggers.length; i++) {
    trigger = self.triggers[i];
    triggerDatabase = trigger.database || self.base.dataSourceSettings.database;

    if (triggerDatabase === tableMap.parentSchema &&
       trigger.table === tableMap.tableName) {
      if (trigger.condition === undefined) {
        return true;
      } else if (eventName === 'updaterows') {
        for (let r = 0; r < rows.length; r++) {
          row = rows[r];
          if (trigger.condition.call(self, row.before, row.after, null)) return true;
        }
      } else {
        // writerows or deleterows
        rowDeleted = eventName === 'deleterows';
        for (let r = 0; r < rows.length; r++) {
          row = rows[r];
          if (trigger.condition.call(self, row, null, rowDeleted)) return true;
        }
      }
    }
  }
  return false;
};

LiveMysqlSelect.prototype.stop = function() {
  const self = this;
  return self.base._removeSelect(self);
};

LiveMysqlSelect.prototype.active = function() {
  const self = this;
  return self.base._select.indexOf(self) !== -1;
};

LiveMysqlSelect.prototype.invalidate = function() {
  const self = this;
  self.queryCache.invalidate();
};

export default LiveMysqlSelect;
