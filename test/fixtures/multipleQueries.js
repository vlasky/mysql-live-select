// Test fixture for multipleQueries test
// Uses the new dictionary-based diff format with Columns(['id']) key selector
export const characters = {
  columns: { id: 'INT UNSIGNED', name: 'VARCHAR(45) NULL', visits: 'INT UNSIGNED' },
  initial: [
    { id: 1, name: 'Celie', visits: 10 },
    { id: 2, name: 'Nettie', visits: 15 },
    { id: 3, name: 'Harpo', visits: 20 },
    { id: 4, name: 'Shug', visits: 25 },
  ],
  select: 'SELECT * FROM $table$ ORDER BY visits DESC',
  // Optional 'condition' function (not specified on this case)
  // Execute a query after initialization and each update thereafter
  queries: [
    // Basic single-row operations
    'UPDATE $table$ SET visits=visits+5 WHERE id=4',
    'UPDATE $table$ SET visits=visits+15 WHERE id=1',
    'INSERT INTO $table$ (id, name, visits) VALUES (5, \'Squeak\', 4)',
    'DELETE FROM $table$ WHERE id=3',
    // Multi-row UPDATE
    'UPDATE $table$ SET visits=visits+1 WHERE id IN (1, 2)',
    // Note: No-op UPDATE (SET visits=visits) removed - MySQL doesn't generate
    // binlog events when values don't actually change, so no diff is emitted
    // Partial column update (only name changes, not visits)
    'UPDATE $table$ SET name=\'Renamed\' WHERE id=2',
    // NULL value
    'UPDATE $table$ SET name=NULL WHERE id=5',
    // Key column change (id=4 becomes id=10)
    'UPDATE $table$ SET id=10 WHERE id=4',
    // Delete + re-insert same id (two separate operations)
    'DELETE FROM $table$ WHERE id=2',
    'INSERT INTO $table$ (id, name, visits) VALUES (2, \'Nettie2\', 50)',
    // Multi-row DELETE
    'DELETE FROM $table$ WHERE visits < 30',
    // Delete all remaining rows (empty result set)
    'DELETE FROM $table$'
  ],
  // Expected diffs using new dictionary format with string keys based on id column
  // Keys are the id values converted to strings (e.g., 1 -> "1")
  expectedDiffs: [
    // Initial data load - all rows added
    {
      added: {
        '1': { id: 1, name: 'Celie', visits: 10 },
        '2': { id: 2, name: 'Nettie', visits: 15 },
        '3': { id: 3, name: 'Harpo', visits: 20 },
        '4': { id: 4, name: 'Shug', visits: 25 }
      },
      changed: {},
      removed: {}
    },
    // After: UPDATE visits for id=4 (25 -> 30)
    {
      added: {},
      changed: { '4': { visits: 30 } },
      removed: {}
    },
    // After: UPDATE visits for id=1 (10 -> 25)
    {
      added: {},
      changed: { '1': { visits: 25 } },
      removed: {}
    },
    // After: INSERT id=5
    {
      added: { '5': { id: 5, name: 'Squeak', visits: 4 } },
      changed: {},
      removed: {}
    },
    // After: DELETE id=3
    {
      added: {},
      changed: {},
      removed: { '3': true }
    },
    // After: Multi-row UPDATE (id=1 visits 25->26, id=2 visits 15->16)
    {
      added: {},
      changed: { '1': { visits: 26 }, '2': { visits: 16 } },
      removed: {}
    },
    // After: Partial column update (id=2 name 'Nettie'->'Renamed')
    {
      added: {},
      changed: { '2': { name: 'Renamed' } },
      removed: {}
    },
    // After: NULL value (id=5 name 'Squeak'->null)
    {
      added: {},
      changed: { '5': { name: null } },
      removed: {}
    },
    // After: Key column change (id=4 becomes id=10)
    {
      added: { '10': { id: 10, name: 'Shug', visits: 30 } },
      changed: {},
      removed: { '4': true }
    },
    // After: DELETE id=2 (part 1 of delete+re-insert)
    {
      added: {},
      changed: {},
      removed: { '2': true }
    },
    // After: INSERT id=2 with new data (part 2 of delete+re-insert)
    {
      added: { '2': { id: 2, name: 'Nettie2', visits: 50 } },
      changed: {},
      removed: {}
    },
    // After: Multi-row DELETE (visits < 30 deletes id=1 and id=5)
    {
      added: {},
      changed: {},
      removed: { '1': true, '5': true }
    },
    // After: DELETE all remaining rows (empty result set)
    {
      added: {},
      changed: {},
      removed: { '2': true, '10': true }
    }
  ],
  // Expected data after applying each diff (dictionary format)
  expectedDatas: [
    // After initial load
    {
      '1': { id: 1, name: 'Celie', visits: 10 },
      '2': { id: 2, name: 'Nettie', visits: 15 },
      '3': { id: 3, name: 'Harpo', visits: 20 },
      '4': { id: 4, name: 'Shug', visits: 25 }
    },
    // After UPDATE id=4
    {
      '1': { id: 1, name: 'Celie', visits: 10 },
      '2': { id: 2, name: 'Nettie', visits: 15 },
      '3': { id: 3, name: 'Harpo', visits: 20 },
      '4': { id: 4, name: 'Shug', visits: 30 }
    },
    // After UPDATE id=1
    {
      '1': { id: 1, name: 'Celie', visits: 25 },
      '2': { id: 2, name: 'Nettie', visits: 15 },
      '3': { id: 3, name: 'Harpo', visits: 20 },
      '4': { id: 4, name: 'Shug', visits: 30 }
    },
    // After INSERT id=5
    {
      '1': { id: 1, name: 'Celie', visits: 25 },
      '2': { id: 2, name: 'Nettie', visits: 15 },
      '3': { id: 3, name: 'Harpo', visits: 20 },
      '4': { id: 4, name: 'Shug', visits: 30 },
      '5': { id: 5, name: 'Squeak', visits: 4 }
    },
    // After DELETE id=3
    {
      '1': { id: 1, name: 'Celie', visits: 25 },
      '2': { id: 2, name: 'Nettie', visits: 15 },
      '4': { id: 4, name: 'Shug', visits: 30 },
      '5': { id: 5, name: 'Squeak', visits: 4 }
    },
    // After multi-row UPDATE (id=1, id=2)
    {
      '1': { id: 1, name: 'Celie', visits: 26 },
      '2': { id: 2, name: 'Nettie', visits: 16 },
      '4': { id: 4, name: 'Shug', visits: 30 },
      '5': { id: 5, name: 'Squeak', visits: 4 }
    },
    // After partial column update (id=2 name changed)
    {
      '1': { id: 1, name: 'Celie', visits: 26 },
      '2': { id: 2, name: 'Renamed', visits: 16 },
      '4': { id: 4, name: 'Shug', visits: 30 },
      '5': { id: 5, name: 'Squeak', visits: 4 }
    },
    // After NULL value (id=5 name=null)
    {
      '1': { id: 1, name: 'Celie', visits: 26 },
      '2': { id: 2, name: 'Renamed', visits: 16 },
      '4': { id: 4, name: 'Shug', visits: 30 },
      '5': { id: 5, name: null, visits: 4 }
    },
    // After key column change (id=4 becomes id=10)
    {
      '1': { id: 1, name: 'Celie', visits: 26 },
      '2': { id: 2, name: 'Renamed', visits: 16 },
      '5': { id: 5, name: null, visits: 4 },
      '10': { id: 10, name: 'Shug', visits: 30 }
    },
    // After DELETE id=2
    {
      '1': { id: 1, name: 'Celie', visits: 26 },
      '5': { id: 5, name: null, visits: 4 },
      '10': { id: 10, name: 'Shug', visits: 30 }
    },
    // After INSERT id=2 (new data)
    {
      '1': { id: 1, name: 'Celie', visits: 26 },
      '2': { id: 2, name: 'Nettie2', visits: 50 },
      '5': { id: 5, name: null, visits: 4 },
      '10': { id: 10, name: 'Shug', visits: 30 }
    },
    // After multi-row DELETE (visits < 30)
    {
      '2': { id: 2, name: 'Nettie2', visits: 50 },
      '10': { id: 10, name: 'Shug', visits: 30 }
    },
    // After DELETE all (empty)
    {}
  ]
}
