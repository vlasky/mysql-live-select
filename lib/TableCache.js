/* mysql-live-select, MIT License
   lib/TableCache.js - In-memory table cache class */

class TableCache {
  constructor(schema, table, keyfield, base) {
    this.schema = schema;
    this.table = table;
    this.base = base;

    this.cache = null;

    this.initialised = false;

    this.keyfield = keyfield;

    //this.keyfunc = LiveMysqlKeySelector.toKeyFunc(LiveMysqlKeySelector.Columns(keyfieldarray));

    this.base.execute(`SELECT * FROM ${this.schema}.${this.table}`, [], (error, rows) => {
      this.cache = {};

      rows.forEach((row, _index) => {
        const key = row[this.keyfield];
        this.cache[key] = { ...row };
      });

      this.initialised = true;
    });
  }

  matchRowEvent(eventName, tableMap, rows) {
    if (this.schema === tableMap.parentSchema && this.table === tableMap.tableName) {
      if (eventName === 'updaterows') {
        rows.forEach((row, _index) => {
          const beforekey = row.before[this.keyfield];
          const afterkey = row.after[this.keyfield];

          this.cache[afterkey] = { ...row.after };

          if (afterkey !== beforekey) {
            delete this.cache[beforekey];
          }
        });
      } else {
        // writerows or deleterows
        const rowDeleted = eventName === 'deleterows';

        if (rowDeleted) {
          rows.forEach((row, _index) => {
            const key = row[this.keyfield];
            delete this.cache[key];
          });
        } else {
          rows.forEach((row, _index) => {
            const key = row[this.keyfield];
            this.cache[key] = { ...row };
          });
        }
      }
    }
  }
}

export default TableCache;
