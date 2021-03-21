var _ = require('lodash');
var differ = require('./differ');
var LiveMysqlKeySelector = require('./LiveMysqlKeySelector');

function TableCache(schema, table, keyfield, base) {

  var self = this;
  self.schema = schema;
  self.table = table;
  self.base = base;

  self.cache = null;

  self.initialised = false;

  self.keyfield = keyfield;

  //self.keyfunc = LiveMysqlKeySelector.toKeyFunc(LiveMysqlKeySelector.Columns(keyfieldarray));

  self.base.execute("SELECT * FROM " + self.schema + "." + self.table + ";", [], function(error, rows) {

    self.cache = {};

    rows.forEach(function(row, index) {
      var key = row[self.keyfield];
      self.cache[key] = _.clone(row);
    });

    self.initialised = true;

  });

}

TableCache.prototype.matchRowEvent = function(eventName, tableMap, rows) {

  var self = this;

  if (self.schema === tableMap.parentSchema && self.table === tableMap.tableName) {
    if (eventName === 'updaterows') {
      rows.forEach(function(row, index) {

        beforekey = row.before[self.keyfield]
        afterkey = row.after[self.keyfield];

        self.cache[afterkey] = _.clone(row.after);

        if (afterkey !== beforekey) {
          delete self.cache[beforekey];
        }
      });
    } else {
      // writerows or deleterows
      rowDeleted = eventName === 'deleterows';

      if (rowDeleted) {
        rows.forEach(function(row, index) {
	        var key = row[self.keyfield];
          delete self.cache[key];
        });
      } else {
        rows.forEach(function(row, index) {
	        var key = row[self.keyfield];
          self.cache[key] = _.clone(row);
        });
      }
    }
  }
};

module.exports = TableCache;
