/* mysql-live-select, MIT License ben@latenightsketches.com
   lib/LiveMysqlSelect.js - Select result set class */
import { EventEmitter } from 'events';

class LiveMysqlSelect extends EventEmitter {
  constructor(queryCache, triggers, base) {
    if (!queryCache)
      throw new Error('queryCache required');
    if (!(triggers instanceof Array))
      throw new Error('triggers array required');
    if (typeof base !== 'object')
      throw new Error('base LiveMysql instance required');

    super();
    this.triggers = triggers;
    this.base = base;
    this.data = {};
    this.queryCache = queryCache;
    queryCache.selects.push(this);

    if (queryCache.initialized) {
      const refLastUpdate = queryCache.lastUpdate;

      // Trigger events for existing data
      setImmediate(() => {
        if (queryCache.lastUpdate !== refLastUpdate) {
          // Query cache has been updated since this select object was created;
          // our data would've been updated already.
          return;
        }

        this.emit('update',
          { added: queryCache.data, changed: null, removed: null },
          queryCache.data);
      });
    } else {
      queryCache.invalidate();
    }
  }

  matchRowEvent(eventName, tableMap, rows) {
    let trigger, row, rowDeleted, triggerDatabase;
    for (let i = 0; i < this.triggers.length; i++) {
      trigger = this.triggers[i];
      triggerDatabase = trigger.database || this.base.dataSourceSettings.database;

      if (triggerDatabase === tableMap.parentSchema &&
         trigger.table === tableMap.tableName) {
        if (trigger.condition === undefined) {
          return true;
        } else if (eventName === 'updaterows') {
          for (let r = 0; r < rows.length; r++) {
            row = rows[r];
            if (trigger.condition.call(this, row.before, row.after, null)) return true;
          }
        } else {
          // writerows or deleterows
          rowDeleted = eventName === 'deleterows';
          for (let r = 0; r < rows.length; r++) {
            row = rows[r];
            if (trigger.condition.call(this, row, null, rowDeleted)) return true;
          }
        }
      }
    }
    return false;
  }

  stop() {
    return this.base._removeSelect(this);
  }

  active() {
    return this.base._select.indexOf(this) !== -1;
  }

  invalidate() {
    this.queryCache.invalidate();
  }
}

export default LiveMysqlSelect;
