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
  .option(
    '-c, --config <path>',
    'path to the config file',
    '/etc/raftctl/config.json'
  );

function getConfig() {
  const options = program.opts();
  const configPath = path.resolve(options.config);
  if (!fs.existsSync(configPath)) {
    console.error(`Error: Configuration file not found at ${configPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath));
}

// This is the core daemon logic for a SINGLE node.
function runSingleDaemon(config) {
  if (!config) {
    console.error('Error: A valid configuration object must be provided to run a daemon.');
    return;
  }

  const logIdentifier = config.address || 'daemon';
  if (config.logFile) {
    const logStream = fs.createWriteStream(config.logFile, { flags: 'a' });
    const logger = (stream, ...args) => {
      stream.write(`[${logIdentifier}] ` + util.format(...args) + '\n');
    };
    console.log = (...args) => logger(logStream, ...args);
    console.error = (...args) => logger(logStream, ...args);
  }

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
        fork(path.resolve(script));
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
  if (config.nodes && Array.isArray(config.nodes)) {
    console.error('Error: This command requires a configuration file for a single node, not a cluster.');
    process.exit(1);
  }
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

function createService() {
    const config = getConfig();
    const configPath = path.resolve(program.opts().config);

    const isCluster = config.nodes && Array.isArray(config.nodes);

    if (!config.serviceName) {
        console.error('Error: "serviceName" must be defined in the config file to create a service.');
        process.exit(1);
    }

    return new Service({
        name: config.serviceName,
        description: config.description || `Raft Consensus Daemon (${config.serviceName})`,
        script: path.resolve(__filename),
        scriptOptions: `--config ${configPath} start`,
    });
}

// --- COMMAND DEFINITIONS ---

program
  .command('start')
  .description('Start one or more daemon instances from a configuration file.')
  .action(() => {
    const config = getConfig();
    const nodesToStart = (config.nodes && Array.isArray(config.nodes)) ? config.nodes : [config];
    const childProcesses = [];

    console.log(`[Manager] Spawning ${nodesToStart.length} node process(es)...`);

    nodesToStart.forEach(nodeConfig => {
      const args = ['start-node', '--config-json', JSON.stringify(nodeConfig)];
      const child = fork(path.resolve(__filename), args);
      childProcesses.push(child);
      console.log(`[Manager] - Spawned process for node at ${nodeConfig.address}`);
    });

    // Keep the manager process alive
    setInterval(() => {}, 1000 * 60 * 60);
    console.log('[Manager] All processes spawned. Manager is now running. Press Ctrl+C to stop.');

    // Graceful shutdown handler
    const shutdown = () => {
      console.log('[Manager] Shutdown signal received. Terminating child processes...');
      childProcesses.forEach(child => {
        child.kill();
      });
      process.exit(0);
    };

    process.on('SIGTERM', shutdown); // `systemctl stop`
    process.on('SIGINT', shutdown);  // Ctrl+C
  });

program
  .command('start-node', { hidden: true })
  .description('Internal command to run a single daemon instance.')
  .requiredOption('--config-json <json>', 'The node config as a JSON string')
  .action((options) => {
    const config = JSON.parse(options.configJson);
    runSingleDaemon(config);
  });

program
  .command('state')
  .description('Check the state of a single node.')
  .action(() => sendCommand({ action: 'state' }));

program
  .command('join <address>')
  .description('Tell a single node to join a cluster by contacting any member at <address>')
  .action((address) => sendCommand({ action: 'join', address: address }));

program
  .command('svcinstall')
  .description('Install a daemon or cluster as a systemd service.')
  .action(() => {
    const svc = createService();
    svc.on('install', () => {
        console.log(`Service "${svc.name}" installed. Start with: sudo systemctl start ${svc.name}`);
    });
    svc.install();
  });

program
  .command('svcuninstall')
  .description('Uninstall a systemd service.')
  .action(() => {
    const svc = createService();
    svc.on('uninstall', () => {
        console.log(`Service "${svc.name}" uninstalled.`);
    });
    svc.uninstall();
  });

program.parse(process.argv);