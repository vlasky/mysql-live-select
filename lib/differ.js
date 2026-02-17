/* mysql-live-select, MIT License wj32.64@gmail.com
   lib/differ.js - Object dictionary differ */

export function makeDiff(oldData, newData) {
  const diff = { added: {}, changed: {}, removed: {} };

  // Detect deletions.
  for (const rowKey of Object.keys(oldData)) {
    if (!(rowKey in newData)) {
      diff.removed[rowKey] = true;
    }
  }

  // Detect additions/changes.
  for (const [rowKey, newRow] of Object.entries(newData)) {
    const oldRow = oldData[rowKey];
    if (oldRow === undefined) {
      diff.added[rowKey] = newRow;
    } else {
      const fields = {};
      for (const key of Object.keys(oldRow)) {
        if (!(key in newRow)) {
          fields[key] = undefined;
        }
      }
      for (const [key, newValue] of Object.entries(newRow)) {
        const oldValue = oldRow[key];
        if (oldValue === undefined || oldValue !== newValue) {
          fields[key] = newValue;
        }
      }
      if (Object.keys(fields).length > 0) {
        diff.changed[rowKey] = fields;
      }
    }
  }

  return diff;
}

export function applyDiff(data, diff) {
  if (diff.removed) {
    for (const rowKey of Object.keys(diff.removed)) {
      delete data[rowKey];
    }
  }
  if (diff.added) {
    for (const [rowKey, row] of Object.entries(diff.added)) {
      data[rowKey] = row;
    }
  }
  if (diff.changed) {
    for (const [rowKey, fields] of Object.entries(diff.changed)) {
      for (const [key, value] of Object.entries(fields)) {
        if (value === undefined) {
          delete data[rowKey][key];
        } else {
          data[rowKey][key] = value;
        }
      }
    }
  }
}
