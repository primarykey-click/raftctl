'use strict';

var EventEmitter = require('events').EventEmitter
  , diagnostics = require('diagnostics')
  , millisecond = require('millisecond')
  , TickTock = require('tick-tock')
  , extend = require('extendible')
  , one = require('one-time')
  , async = require('async')
  , net = require('net')
  , { URL } = require('url');

var LEADER = 1
  , CANDIDATE = 2
  , FOLLOWER = 3
  , UNINITIALIZED = 4;

var debug = diagnostics('liferaft');

function LifeRaft(address, options)
{
  if ('string' === typeof address)
  {
    var parts = address.split(':');
    this.host = parts[0];
    this.port = +parts[1];
  }
  else if ('object' === typeof address && address.port && address.host)
  {
    options = address;
    this.port = options.port;
    this.host = options.host;
  }
  else
  {
    options = address;
  }

  options = options || {};
  this.options = {
    'heartbeat': options.heartbeat || '50 ms',
    'election min': options.election === 0 ? 0 : options['election min'] || '150 ms',
    'election max': options.election === 0 ? 0 : options['election max'] || '300 ms',
    'adapter': options.adapter || require('level').Level,
    'path': options.path || process.cwd() +'/db/'+ this.port
  };
  this.timers = new TickTock(this);
  this.connections = [];

  const rootDb = new this.options.adapter(this.options.path);
  this.log = rootDb.sublevel('log', { valueEncoding: 'json' });
  this.db = rootDb.sublevel('db', { valueEncoding: 'json' });

  rootDb.open((err) =>
  {
    if (err)
    {
      console.error('Fatal: Database failed to open.');
      return this.emit('error', err);
    }
    debug('database opened successfully');
    this.initialize();
  });
}

LifeRaft.prototype = new EventEmitter();
LifeRaft.prototype.constructor = LifeRaft;
LifeRaft.prototype.emits = require('emits');
LifeRaft.prototype.extend = extend;

LifeRaft.prototype.LEADER = LEADER;
LifeRaft.prototype.CANDIDATE = CANDIDATE;
LifeRaft.prototype.FOLLOWER = FOLLOWER;
LifeRaft.prototype.UNINITIALIZED = UNINITIALIZED;
LifeRaft.states = {
  LEADER: LEADER,
  CANDIDATE: CANDIDATE,
  FOLLOWER: FOLLOWER,
  UNINITIALIZED: UNINITIALIZED,
  1: 'LEADER',
  2: 'CANDIDATE',
  3: 'FOLLOWER',
  4: 'UNINITIALIZED'
};

LifeRaft.prototype.initialize = function initialize()
{
  var raft = this;
  debug('initializing raft instance');
  this.state = UNINITIALIZED;
  this.leader = null;
  this.votes = 0;
  this.term = 0;
  this.voted = { term: 0, candidate: null };
  this.db.get('term', function (err, term)
  {
    if (err && err.notFound) term = 0;
    else if (err) return raft.emit('error', err);
    raft.term = +term;
    raft.listen(function server()
    {
      debug('listening on %s:%s', raft.host, raft.port);
      raft.emit('listen');
      raft.transition(FOLLOWER);
    });
  });
};

LifeRaft.prototype.listen = function listen(fn)
{
  var raft = this;
  this.once('listening', fn);
  this.server = net.createServer(function createServer(socket)
  {
    raft.connected(socket);
  });
  this.server.on('error', function error(err)
  {
    debug('server error: %s', err.message);
    raft.emit('error', err);
  });
  this.server.listen(this.port, this.host, function listening()
  {
    raft.emit('listening');
  });
  return this;
};

LifeRaft.prototype.destroy = require('demolish')('server', 'log', 'db', 'connections', 'timers');

LifeRaft.prototype.timeout = function timeout()
{
  var min = millisecond(this.options['election min']);
  var max = millisecond(this.options['election max']);
  return Math.floor(Math.random() * (max - min + 1) + min);
};

LifeRaft.prototype.connected = function connected(socket)
{
  var raft = this;
  socket.on('error', function error(err)
  {
    debug('received an error on the socket: %s', err.message);
  }).on('data', function data(buffer)
  {
    var packet;
    try
    {
      packet = JSON.parse(buffer.toString());
    }
    catch (e)
    {
      return socket.destroy();
    }
    debug('received data packet', packet);
    if (packet.term > raft.term)
    {
      raft.term = packet.term;
      raft.transition(FOLLOWER);
    }
    raft.emit('data', packet, function reply(data, shouldEnd)
    {
      debug('writing response packet', data);
      socket.write(JSON.stringify(data));
      if (shouldEnd) socket.end();
    });
  }).once('close', function close()
  {
    var i = raft.connections.indexOf(socket);
    if (~i) raft.connections.splice(i, 1);
  });
  this.connections.push(socket);
};

LifeRaft.prototype.write = function write(socket, packet)
{
  packet.term = this.term;
  packet.address = this.address;
  socket.write(JSON.stringify(packet));
};

LifeRaft.prototype.join = function join(address)
{
  debug('establishing persistent connection to %s', address);
  this.transition(FOLLOWER);
  const url = new URL(address);
  const socket = net.connect({ port: +url.port, host: url.hostname });
  this.connected(socket);
  return socket;
};

LifeRaft.prototype.discoverAndJoin = function discoverAndJoin(address)
{
  debug('discovering leader by contacting %s', address);
  const url = new URL(address);
  const socket = net.connect({ port: +url.port, host: url.hostname });
  const raft = this;
  socket.on('connect', () =>
  {
    this.write(socket, { name: 'discover-leader' });
  });
  socket.on('data', (buffer) =>
  {
    var packet;
    try
    {
      packet = JSON.parse(buffer.toString());
    }
    catch (e)
    {
      return socket.destroy();
    }
    if (packet.name === 'leader-is' && packet.leader)
    {
      debug('discovered leader is %s', packet.leader);
      if (packet.leader !== this.address)
      {
        this.join(packet.leader);
      }
    }
    socket.destroy();
  });
  socket.on('error', (err) =>
  {
    debug('discovery connection to %s failed: %s', address, err.message);
  });
};

LifeRaft.prototype.getClusterState = function getClusterState(callback)
{
  if (this.state !== LEADER)
  {
    return callback({
      address: this.address,
      state: LifeRaft.states[this.state],
      leader: this.leader,
      notice: "This is the state of a single node. Query the leader for full cluster status."
    });
  }
  const clusterState = [{
    address: this.address,
    state: LifeRaft.states[this.state],
    leader: null
  }];
  async.map(this.connections, (socket, next) =>
  {
    const tempSocket = net.connect({ port: socket.remotePort, host: socket.remoteAddress });
    let responseData = '';
    tempSocket.on('connect', () =>
    {
      this.write(tempSocket, { name: 'get-state' });
    });
    tempSocket.on('data', (buffer) =>
    {
      responseData += buffer.toString();
    });
    tempSocket.on('close', () =>
    {
      try
      {
        next(null, JSON.parse(responseData));
      }
      catch (e)
      {
        next(e);
      }
    });
    tempSocket.on('error', (err) =>
    {
      next(err);
    });
  }, (err, results) =>
  {
    if (err)
    {
      debug('Error polling followers for state:', err);
      return callback(clusterState);
    }
    callback(clusterState.concat(results));
  });
};

LifeRaft.prototype.on('data', function data(packet, reply)
{
  if (packet.name === 'discover-leader')
  {
    reply({ name: 'leader-is', leader: this.state === LEADER ? this.address : this.leader }, true);
    return;
  }
  
  if (packet.name === 'get-state')
  {
    reply({
      address: this.address,
      state: LifeRaft.states[this.state],
      leader: this.leader
    }, true);
    return;
  }

  switch (this.state)
  {
    case FOLLOWER:
      if ('append' === packet.name)
      {
        this.leader = packet.leader;
        this.reset();
        reply({ success: true, term: this.term });
      }
      else if ('vote' === packet.name)
      {
        if (this.voted.term < packet.term || !this.voted.candidate)
        {
          this.voted.term = this.term;
          this.voted.candidate = packet.candidate;
          this.reset();
          reply({ success: true, term: this.term });
        }
        else
        {
          reply({ success: false, term: this.term });
        }
      }
      break;
    case CANDIDATE:
      const majority = Math.floor(this.connections.length / 2) + 1;
      if ('vote' === packet.name && packet.success)
      {
        this.votes++;
        if (this.votes >= majority)
        {
          this.transition(LEADER);
        }
      }
      break;
    case LEADER:
      if ('vote' === packet.name)
      {
        reply({ success: false, term: this.term });
      }
      break;
  }
});

LifeRaft.prototype.heartbeat = function heartbeat()
{
  debug('sending heartbeats to all connections');
  this.connections.forEach(function each(socket)
  {
    this.write(socket, { name: 'append', leader: this.address });
  }, this);
};

LifeRaft.prototype.election = function election()
{
  debug('starting a new election for term %s', this.term);
  this.term++;
  this.votes = 0;
  this.transition(CANDIDATE);
  this.votes++;
  this.voted.term = this.term;
  this.voted.candidate = this.address;
  const majority = Math.floor(this.connections.length / 2) + 1;
  if (this.votes >= majority)
  {
    return this.transition(LEADER);
  }
  this.connections.forEach(function each(socket)
  {
    this.write(socket, { name: 'vote', candidate: this.address });
  }, this);
};

Object.defineProperty(LifeRaft.prototype, 'address', {
  get: function address()
  {
    var addr = this.server.address();
    return 'tcp://' + addr.address + ':' + addr.port;
  }
});

LifeRaft.prototype.transition = function transition(state)
{
  if (this.state === state) return;
  var old = this.state;
  this.state = state;
  debug('transitioning from %s to %s', LifeRaft.states[old], LifeRaft.states[state]);
  this.emit('state', state, old);
  this.timers.clear();
  switch (state)
  {
    case FOLLOWER:
      this.timers.setTimeout('election', this.election, this.timeout());
      this.emit('follower');
      break;
    case CANDIDATE:
      this.timers.setTimeout('election', this.election, this.timeout());
      this.emit('candidate');
      break;
    case LEADER:
      this.timers.setInterval('heartbeat', this.heartbeat, this.options.heartbeat);
      this.emit('leader');
      break;
  }
};

LifeRaft.prototype.reset = function reset()
{
  debug('resetting the election timer');
  this.timers.clear('election');
  this.timers.setTimeout('election', this.election, this.timeout());
};

LifeRaft.prototype.save = function save(fn)
{
  var raft = this;
  fn = one(fn || function nope(err)
  {
    if (err) raft.emit('error', err);
  });
  this.db.put('term', this.term, fn);
};

module.exports = LifeRaft;