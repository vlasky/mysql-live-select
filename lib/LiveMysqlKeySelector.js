/* mysql-live-select, MIT License wj32.64@gmail.com
   lib/LiveMysqlKeySelector.js - Key selector class */
var _ = require('lodash');
var EJSON = require('ejson');

var LiveMysqlKeySelector = {}

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
};

LiveMysqlKeySelector.toKeyFunc = function(keySelector) {
  return keySelector({
    index: function() {
      return function(row, index) {
        return index.toString();
      };
    },
    columns: function(columnList) {
      if (columnList.length == 1) {
        var column = columnList[0];
        return function(row) {
          var value = row[column];
          if (typeof value == 'undefined') {
            //Throw an exception
            throw new Error("KeySelector.columns: undefined column in row:\n" + JSON.stringify(row));
          } else if (value === null) {
            //Throw an exception
            throw new Error("KeySelector.columns: null column in row:\n" + JSON.stringify(row));
          } else if (value instanceof Date) {
            // Special case: use a canonical representation for dates.
            return value.getTime().toString();
          } else if (value instanceof Object) {
            // See explanation below.
            return '!' + EJSON.stringify(value, {canonical:true});
          } else if (typeof value == 'string') {
            return '"' + value + '"';
          } else {
            return value.toString();
          }
        };
      } else {
        return function(row) {
          // Meteor's mongo-id package has a function called idStringify that
          // adds a dash to the beginning of an _id if it starts with '{'. To
          // avoid inconsistencies, we add '!' to stop the dash from being added.
          return '!' + EJSON.stringify(_.pick(row, columnList), {canonical:true});
        };
      }
    },
    func: _.identity
  });
};

module.exports = LiveMysqlKeySelector;
