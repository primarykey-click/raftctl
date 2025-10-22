#!/usr/bin/env node

const { Command } = require('commander');
const fs = require('fs');
const net = require('net');
const path = require('path');
const util = require('util');
const { fork } = require('child_process');
const { Service } = require('node-linux');
const LifeRaft = require('./liferaft.js');

const program = new Command();

program
  .option('-c, --config <path>', 'path to the config file', '/etc/raftctl/config.json');

function getConfig() {
  const options = program.opts();
  // Resolve to an absolute path for the service
  const configPath = path.resolve(options.config);
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Configuration file not found at ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath));
}

// Set up logging to a file (only for the daemon)
function setupLogging(config) {
  if (!config.logFile) return;

  const logStream = fs.createWriteStream(config.logFile, { flags: 'a' });
  
  // Overwrite console.log and console.error to redirect to the log file
  const logger = (stream, ...args) => {
    stream.write(util.format(...args) + '\n');
  };

  console.log = (...args) => logger(logStream, ...args);
  console.error = (...args) => logger(logStream, ...args);
}

function startDaemon() {
  const config = getConfig();
  setupLogging(config);

  console.log(`--- Starting Daemon: ${new Date().toISOString()} ---`);
  
  const raft = new LifeRaft({
    host: '127.0.0.1',
    port: parseInt(new URL(config.address).port),
    'election min': config['election min'],
    'election max': config['election max'],
  });

  if (config.events) {
    for (const event in config.events) {
      const script = config.events[event];
      raft.on(event, () => {
        console.log(`[Event: ${event}] Executing script: ${script}`);
        fork(script);
      });
    }
  }

  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      const command = JSON.parse(data.toString());
      if (command.action === 'state') {
        socket.write(JSON.stringify({ state: LifeRaft.states[raft.state] }));
      } else if (command.action === 'join') {
        console.log(`Received join command for address: ${command.address}`);
        raft.discoverAndJoin(command.address);
        socket.write(JSON.stringify({ status: 'ok, discovery initiated' }));
      }
    });
  });

  server.listen(config.command_port, '127.0.0.1', () => {
    console.log(`Command server listening on port ${config.command_port}`);
  });

  raft.on('listen', () => {
    console.log(`Raft node listening at ${raft.address}`);
    if (config.clusterNodes && config.clusterNodes.length > 0) {
      console.log('Attempting to join cluster nodes...');
      config.clusterNodes.forEach(nodeAddress => {
        if (nodeAddress !== raft.address) {
          raft.discoverAndJoin(nodeAddress);
        }
      });
    }
  });
}

function sendCommand(command) {
  const config = getConfig();
  const client = new net.Socket();
  client.connect(config.command_port, '127.0.0.1', () => {
    client.write(JSON.stringify(command));
  });
  client.on('data', (data) => {
    console.log(JSON.parse(data.toString()));
    client.destroy();
  });
  client.on('error', (err) => {
    console.error('Error connecting to daemon. Is it running?');
  });
}

// Function to create the service object
function createService() {
    const config = getConfig();
    const configPath = path.resolve(program.opts().config);

    if (!config.serviceName) {
        console.error('Error: "serviceName" must be defined in the config file.');
        process.exit(1);
    }

    return new Service({
        name: config.serviceName,
        description: `Raft Consensus Daemon Node (${config.serviceName})`,
        // The script path and the arguments for it
        script: path.resolve(__dirname, 'index.js'),
        scriptOptions: `--config ${configPath} start`,
        // Optional: Run as a specific user.
        // user: 'node'
    });
}

program
  .command('start')
  .description('Start the consensus daemon')
  .action(startDaemon);

program
  .command('state')
  .description('Check the state of the node')
  .action(() => sendCommand({ action: 'state' }));

program
  .command('join <address>')
  .description('Join the cluster by contacting any node at <address>')
  .action((address) => sendCommand({ action: 'join', address: address }));

program
  .command('svcinstall')
  .description('Install the daemon as a systemd service')
  .action(() => {
    const svc = createService();
    svc.on('install', () => {
        console.log(`Service "${svc.name}" installed.`);
        console.log('You can now start it with:');
        console.log(`sudo systemctl start ${svc.name}`);
    });
    svc.install();
  });

program
  .command('svcuninstall')
  .description('Uninstall the systemd service')
  .action(() => {
    const svc = createService();
    svc.on('uninstall', () => {
        console.log(`Service "${svc.name}" uninstalled.`);
    });
    svc.uninstall();
  });

program.parse(process.argv);

