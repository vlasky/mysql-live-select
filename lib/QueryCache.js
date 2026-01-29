/* mysql-live-select, MIT License ben@latenightsketches.com, wj32.64@gmail.com
   lib/QueryCache.js - Query results cache class

   Many LiveMysqlSelect objects can share the same query cache if they have the
   same query string.
*/

import * as differ from './differ.js';
import LiveMysqlKeySelector from './LiveMysqlKeySelector.js';

class QueryCache {
  constructor(query, values, queryCacheKey, keySelector, minInterval, base) {
    if (!query)
      throw new Error('query required');
    if (!(keySelector instanceof Function))
      throw new Error('keySelector required');

    this.base = base;
    this.query = query;
    this.values = values;
    this.queryCacheKey = queryCacheKey;
    this.needUpdate = false;
    this.updating = false;
    this.lastUpdate = 0;
    this.data = {};
    this.selects = [];
    this.initialized = false;
    this.updateTimeout = null;
    this.keyFunc = LiveMysqlKeySelector.toKeyFunc(keySelector);
    this.minInterval = minInterval;
  }

  setData(data) {
    this.data = data;
    for (let i = 0; i < this.selects.length; i++) {
      this.selects[i].data = this.data;
    }
  }

  _emitOnSelects(/* arguments */) {
    try {
      for (let i = 0; i < this.selects.length; i++) {
        const select = this.selects[i];
        select.emit.apply(select, arguments);
      }
    } catch (e) {
      if(false === this.base.userInitiatedClose) throw e;
    }
  }

  matchRowEvent(eventName, tableMap, rows) {
    for (let i = 0; i < this.selects.length; i++) {
      if (this.selects[i].matchRowEvent(eventName, tableMap, rows))
        return true;
    }
    return false;
  }

  invalidate() {
    const update = () => {
      if (this.updating) {
        this.needUpdate = true;
        return;
      }

      this.lastUpdate = Date.now();
      this.updating = true;
      this.needUpdate = false;

      // Perform the update
      this.base.execute(this.query, this.values, (error, rows) => {
        this.updating = false;

        if (error)
          return this._emitOnSelects('error', error);

        const newData = {};
        rows.forEach((row, index) => {
          newData[this.keyFunc(row, index)] = row;
        });

        if (rows.length === 0 && this.initialized === false) {
          // If the result set initializes to 0 rows, it still needs to output an
          // update event.
          this._emitOnSelects('update',
            { added: {}, changed: null, removed: null },
            {});
        } else {
          // Perform a diff and notify the select objects.
          const diff = differ.makeDiff(this.data, newData);
          this._emitOnSelects('update', diff, newData);
        }

        this.setData(newData);
        this.initialized = true;

        if (this.needUpdate) {
          schedule();
        }
      });
    };

    const schedule = () => {
      if (typeof this.minInterval !== 'number') {
        update();
      } else if (this.lastUpdate + this.minInterval < Date.now()) {
        update();
      } else { // Before minInterval
        if (this.updateTimeout === null) {
          this.updateTimeout = setTimeout(() => {
            this.updateTimeout = null;
            update();
          }, this.lastUpdate + this.minInterval - Date.now());
        }
      }
    };

    schedule();
  }
}

export default QueryCache;
