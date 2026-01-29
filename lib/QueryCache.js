/* mysql-live-select, MIT License ben@latenightsketches.com, wj32.64@gmail.com
   lib/QueryCache.js - Query results cache class

   Many LiveMysqlSelect objects can share the same query cache if they have the
   same query string.
*/

import * as differ from './differ.js';
import LiveMysqlKeySelector from './LiveMysqlKeySelector.js';

function QueryCache(query, values, queryCacheKey, keySelector, minInterval, base) {
  if (!query)
    throw new Error('query required');
  if (!(keySelector instanceof Function))
    throw new Error('keySelector required');

  const self = this;
  self.base = base;
  self.query = query;
  self.values = values;
  self.queryCacheKey = queryCacheKey;
  self.needUpdate = false;
  self.updating = false;
  self.lastUpdate = 0;
  self.data = {};
  self.selects = [];
  self.initialized = false;
  self.updateTimeout = null;
  self.keyFunc = LiveMysqlKeySelector.toKeyFunc(keySelector);
  self.minInterval = minInterval;
}

QueryCache.prototype.setData = function(data) {
  const self = this;
  self.data = data;
  for (let i = 0; i < self.selects.length; i++) {
    self.selects[i].data = self.data;
  }
};

QueryCache.prototype._emitOnSelects = function(/* arguments */) {
  const self = this;
  try {
    for (let i = 0; i < self.selects.length; i++) {
      const select = self.selects[i];
      select.emit.apply(select, arguments);
    }
  } catch (e) {
    if(false === self.base.userInitiatedClose) throw e;
  }
};

QueryCache.prototype.matchRowEvent = function(eventName, tableMap, rows) {
  const self = this;
  for (let i = 0; i < self.selects.length; i++) {
    if (self.selects[i].matchRowEvent(eventName, tableMap, rows))
      return true;
  }
  return false;
};

QueryCache.prototype.invalidate = function() {
  const self = this;

  function update() {
    if (self.updating) {
      self.needUpdate = true;
      return;
    }

    self.lastUpdate = Date.now();
    self.updating = true;
    self.needUpdate = false;

    // Perform the update
    self.base.execute(self.query, self.values, function(error, rows) {
      self.updating = false;

      if (error)
        return self._emitOnSelects('error', error);

      const newData = {};
      rows.forEach(function(row, index) {
        newData[self.keyFunc(row, index)] = row;
      });

      if (rows.length === 0 && self.initialized === false) {
        // If the result set initializes to 0 rows, it still needs to output an
        // update event.
        self._emitOnSelects('update',
          { added: {}, changed: null, removed: null },
          {});
      } else {
        // Perform a diff and notify the select objects.
        const diff = differ.makeDiff(self.data, newData);
        self._emitOnSelects('update', diff, newData);
      }

      self.setData(newData);
      self.initialized = true;

      if (self.needUpdate) {
        schedule();
      }
    });
  }

  function schedule() {
    if (typeof self.minInterval !== 'number') {
      update();
    } else if (self.lastUpdate + self.minInterval < Date.now()) {
      update();
    } else { // Before minInterval
      if (self.updateTimeout === null) {
        self.updateTimeout = setTimeout(function() {
          self.updateTimeout = null;
          update();
        }, self.lastUpdate + self.minInterval - Date.now());
      }
    }
  }

  schedule();
};

export default QueryCache;
