const callbackDelay = process.env.QUERY_DELAY || 800;

// Execute a sequence of queries on a node-mysql database connection
// @param {object} connection - Node-Mysql Connection, Connected
// @param {boolean} debug - Print queries as they execute (optional)
// @param {[string]} queries - Queries to execute, in order
// @param {function} callback - Call when complete
export default function querySequence(connection, debug, queries, callback){
  if(debug instanceof Array){
    callback = queries;
    queries = debug;
    debug = false;
  }
  const results = [];
  const sequence = queries.map(function(queryStr, index, _initQueries){
    return function(){
      debug && console.log('Query Sequence', index, queryStr);
      connection.query(queryStr, function(err, rows, _fields){
        if(err) throw err;
        results.push(rows);
        if(index < sequence.length - 1){
          sequence[index + 1]();
        }else{
          setTimeout(function(){
            callback(results);
          }, callbackDelay);
        }
      });
    }
  });
  sequence[0]();
}
