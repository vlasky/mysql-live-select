/* mysql-live-select, MIT License ben@latenightsketches.com
   test/helpers/connector.js - Connect to database */
import { EventEmitter } from 'events';
import util from 'util';
import LiveMysql from '../../lib/LiveMysql.js';
import LiveMysqlKeySelector from '../../lib/LiveMysqlKeySelector.js';
import querySequence from './querySequence.js';

function Connector(settings){
  const self = this;
  EventEmitter.call(self);
  self.database = settings.database;
  delete settings.database;
  self.conn = new LiveMysql(settings);
  self.ready = false;
  self.testCount = 0;

  // Log all queries (both query and execute methods)
  self.queries = [];
  const origQueryMethod = self.conn.db.query;
  self.conn.db.query = function(query){
    self.queries.push(query);
    return origQueryMethod.apply(this, arguments);
  }

  // Also track execute calls (used by QueryCache for SELECT queries)
  const origExecuteMethod = self.conn.db.execute;
  self.conn.db.execute = function(query){
    self.queries.push(query);
    return origExecuteMethod.apply(this, arguments);
  }
  // Update the bound execute reference in conn
  self.conn.execute = self.conn.db.execute.bind(self.conn.db);

  const escId = self.conn.db.escapeId;
  const esc = self.conn.db.escape.bind(self.conn.db);

  querySequence(self.conn.db, [
    'DROP DATABASE IF EXISTS ' + escId(self.database),
    'CREATE DATABASE ' + escId(self.database),
    'USE ' + escId(self.database),
  ], function(_results){
    self.ready = true;
    self.emit('ready', self.conn, esc, escId, self.queries, LiveMysqlKeySelector);
  });

  setTimeout(function(){
    self.on('newListener', function(event, listener){
      if(event === 'ready'){
        if(self.ready) listener(self.conn, esc, escId, self.queries, LiveMysqlKeySelector);
      }
    });
  }, 1);

}

util.inherits(Connector, EventEmitter);

Connector.prototype.closeIfInactive = function(interval){
  const self = this;
  const startCount = self.testCount;
  setTimeout(function(){
    if(startCount === self.testCount){
      self.conn.end();
    }
  }, interval);
};

export default Connector;
