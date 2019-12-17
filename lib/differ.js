/* mysql-live-select, MIT License wj32.64@gmail.com
   lib/differ.js - Object dictionary differ */
var _ = require('lodash');

exports.makeDiff = function(oldData, newData) {
  var diff = { added: {}, changed: {}, removed: {} };

  // Detect deletions.
  _.each(oldData, function(row, rowKey) {
    if (!(rowKey in newData)) {
      diff.removed[rowKey] = true;
    }
  });

  // Detect additions/changes.
  _.each(newData, function(newRow, rowKey) {
    var oldRow = oldData[rowKey];
    if (oldRow === undefined) {
      diff.added[rowKey] = newRow;
    } else {
      var fields = {};
      _.each(oldRow, function(value, key) {
        if (!(key in newRow)) {
          fields[key] = undefined;
        }
      });
      _.each(newRow, function(newValue, key) {
        var oldValue = oldRow[key];
        if (oldValue === undefined || !_.isEqual(oldValue, newValue)) {
          fields[key] = newValue;
        }
      });
      if (!_.isEmpty(fields)) {
        diff.changed[rowKey] = fields;
      }
    }
  });

  return diff;
};

exports.applyDiff = function(data, diff) {
  if (diff.removed) {
    _.each(diff.removed, function(dummy, rowKey) {
      delete data[rowKey];
    });
  }
  if (diff.added) {
    _.each(diff.added, function(row, rowKey) {
      data[rowKey] = row;
    });
  }
  if (diff.changed) {
    _.each(diff.changed, function(fields, rowKey) {
      _.each(fields, function(value, key) {
        if (value === undefined) {
          delete data[rowKey][key];
        } else {
          data[rowKey][key] = value;
        }
      });
    });
  }
};
