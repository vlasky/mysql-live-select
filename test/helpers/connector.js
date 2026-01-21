/* mysql-live-select, MIT License ben@latenightsketches.com
   test/helpers/connector.js - Connect to database */
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var LiveMysql = require('../../');
var LiveMysqlKeySelector = require('../../lib/LiveMysqlKeySelector');
var querySequence = require('./querySequence');

function Connector(settings){
  var self = this;
  EventEmitter.call(self);
  self.database = settings.database;
  delete settings.database;
  self.conn = new LiveMysql(settings);
  self.ready = false;
  self.testCount = 0;

  // Log all queries (both query and execute methods)
  self.queries = [];
  var origQueryMethod = self.conn.db.query;
  self.conn.db.query = function(query){
    self.queries.push(query);
    return origQueryMethod.apply(this, arguments);
  }

  // Also track execute calls (used by QueryCache for SELECT queries)
  var origExecuteMethod = self.conn.db.execute;
  self.conn.db.execute = function(query){
    self.queries.push(query);
    return origExecuteMethod.apply(this, arguments);
  }
  // Update the bound execute reference in conn
  self.conn.execute = self.conn.db.execute.bind(self.conn.db);

  var escId = self.conn.db.escapeId;
  var esc = self.conn.db.escape.bind(self.conn.db);

  querySequence(self.conn.db, [
    'DROP DATABASE IF EXISTS ' + escId(self.database),
    'CREATE DATABASE ' + escId(self.database),
    'USE ' + escId(self.database),
  ], function(results){
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

};

util.inherits(Connector, EventEmitter);

Connector.prototype.closeIfInactive = function(interval){
  var self = this;
  var startCount = self.testCount;
  setTimeout(function(){
    if(startCount === self.testCount){
      self.conn.end();
    }
  }, interval);
};

module.exports = Connector;
