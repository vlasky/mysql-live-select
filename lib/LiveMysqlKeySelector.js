/* mysql-live-select, MIT License wj32.64@gmail.com
   lib/LiveMysqlKeySelector.js - Key selector class */
var util = require('util');
var _ = require('lodash');
var EJSON = require('EJSON');

LiveMysqlKeySelector = {}

LiveMysqlKeySelector.Index = function() {
  return function(cases) {
    return cases.index();
  };
};

LiveMysqlKeySelector.Columns = function(columnList) {
  columnList = columnList.concat().sort();
  return function(cases) {
    return cases.columns(columnList);
  };
};

LiveMysqlKeySelector.Func = function(keyFunc) {
  return function(cases) {
    return cases.func(keyFunc);
  };
};

LiveMysqlKeySelector.makeTag = function(keySelector) {
  return keySelector({
    index: function() { return 'index'; },
    columns: function(columnList) { return 'columns: ' + columnList.join(','); },
    func: function(keyFunc) {
      return 'func: ' + Math.random().toString() + ';' + Math.random().toString();
    }
  });
}

LiveMysqlKeySelector.toKeyFunc = function(keySelector) {
  return keySelector({
    index: function() {
      return function(row, index) {
        return index.toString();
      };
    },
    columns: function(columnList) {
      return function(row) {
        return EJSON.stringify(_.pick(row, columnList), {canonical:true});
      };
    },
    func: _.identity
  });
};

module.exports = LiveMysqlKeySelector;