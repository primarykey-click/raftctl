
# RaftCTL - A Node.js Raft Consensus Daemon

RaftCTL is a lightweight, self-clustering consensus daemon and command-line tool for managing highly-available services using the Raft protocol. It is designed to be a configurable and easy-to-use tool for creating small, fault-tolerant clusters.

## Key Features

-   **Raft Consensus:** Implements the Raft consensus algorithm to ensure a single leader and consistent state across nodes.
-   **Multi-Node Process Management:** Start, stop, and manage an entire multi-node cluster on a single machine with a single command.
-   **Auto-Clustering:** Nodes can automatically discover and join each other on startup using a shared list of cluster members.
-   **Smart Join with Leader Discovery:** A new node can join the cluster by contacting any member, which will intelligently forward it to the current leader.
-   **Event-Driven Scripting:** Execute custom `.js` scripts in response to Raft events like a node becoming a `leader` or `follower`.
-   **Systemd Service Management:** Includes commands to install, uninstall, and manage single-node or multi-node clusters as a Linux `systemd` service.
-   **Global CLI:** Can be installed globally, providing a system-wide `raftctl` command for managing nodes.
-   **Configurable Logging:** All daemon output can be redirected to a configurable log file.

## Prerequisites

-   **Node.js** (v16.x or later recommended)
-   **npm** (comes with Node.js)
-   **Linux** (for `systemd` service management)

## Installation

The application is designed to be installed as a global command-line tool.

1.  **Clone the repository and `cd` into it.**
2.  **Make the script executable:** `chmod +x index.js`
3.  **Install Dependencies:** `npm install`
4.  **Link for Development (Recommended):** `npm link`
5.  **Global Install (Production):** `npm install -g .`

## Configuration

RaftCTL uses JSON configuration files, conventionally stored in `/etc/raftctl/`. There are two formats: one for defining a single node and one for defining a multi-node cluster service.

### Single-Node Configuration

A simple JSON object. This format is used to define a single daemon. It is **required** when you want to target a specific node with commands like `state` or `join`.

**Example: `/etc/raftctl/node1.json`**
```json
{
  "address": "tcp://localhost:8089",
  "command_port": 10000,
  "serviceName": "raft-daemon-1",
  "logFile": "/var/log/raft-daemon-1.log",
  "election min": "200 millisecond",
  "election max": "1 second"
}
```

### Multi-Node Cluster Configuration

A JSON object containing a top-level `serviceName` and a `nodes` array. This format is used to define a group of nodes that can be installed and managed as a **single `systemd` service**.

**Example: `/etc/raftctl/local-cluster.json`**
```json
{
  "serviceName": "raft-cluster-local",
  "description": "My Local 3-Node Raft Cluster",
  "nodes": [
    {
      "address": "tcp://localhost:8089",
      "command_port": 10000,
      "logFile": "/var/log/raft-daemon-1.log",
      "clusterNodes": ["tcp://localhost:8089", "tcp://localhost:8090"]
    },
    {
      "address": "tcp://localhost:8090",
      "command_port": 10001,
      "logFile": "/var/log/raft-daemon-2.log",
      "clusterNodes": ["tcp://localhost:8089", "tcp://localhost:8090"]
    }
  ]
}
```

### Event-Driven Scripting

RaftCTL can execute custom JavaScript files when a node changes its state (e.g., becomes a leader or follower). This allows you to build powerful, automated reactions to cluster events, such as reconfiguring a proxy or notifying an external service.

To use this feature, add an `events` object to your configuration file. The keys are the event names (`leader`, `follower`), and the values are the paths to the scripts you want to execute. It's highly recommended to use **absolute paths** for scripts, especially when running as a service.

**1. Update your configuration file:**

Add the `events` block to your node's configuration.

**`/etc/raftctl/node1.json`**
```json
{
  "address": "tcp://localhost:8089",
  "command_port": 10000,
  "serviceName": "raft-daemon-1",
  "logFile": "/var/log/raft-daemon-1.log",
  "events": {
    "leader": "/etc/raftctl/scripts/on_leader.js",
    "follower": "/etc/raftctl/scripts/on_follower.js"
  }
}
```

**2. Create the event scripts:**

Create the corresponding files. The scripts are executed with Node.js.

**`/etc/raftctl/scripts/on_leader.js`**
```javascript
// on_leader.js
const fs = require('fs');
const path = require('path');

const message = `[${new Date().toISOString()}] This node is now the LEADER.\n`;
const statusFile = path.join('/var/run/raftctl', 'status.txt');

// Ensure the directory exists
fs.mkdirSync(path.dirname(statusFile), { recursive: true });

// Append a status update to a file
fs.appendFileSync(statusFile, message);

// You could also execute a shell command, notify a service, etc.
```

**How It Works:** The scripts are executed in a separate process using Node.js's `child_process.fork()`, so they will not block the main daemon's event loop.

## Command-Line Interface (CLI)

Once installed globally, all commands are run using `raftctl`.

### General Commands

-   **Get Help:**
    `raftctl --help`

-   **Get Version:**
    Prints the application's version number.
    `raftctl version` (or `raftctl -v`, `raftctl --version`)

-   **Start a Daemon or Cluster (Manual):**
    Starts a manager process in the foreground which spawns all defined nodes.
    `raftctl --config /etc/raftctl/local-cluster.json start`

-   **Check a Single Node's State:**
    Connects to a *specific* running daemon to print its state. Requires a single-node config file to know which `command_port` to use.
    `raftctl --config /etc/raftctl/node1.json state`

-   **Join a Cluster:**
    Tells a new node to join an existing cluster. Requires a single-node config for the new node.
    `raftctl --config /etc/raftctl/new_node.json join tcp://existing-node-ip:8089`

### System Service Commands (`sudo` required)

-   **Install as a Service:**
    Installs a `systemd` service for either a single node or a multi-node cluster, depending on the config file format.
    `sudo raftctl --config /etc/raftctl/local-cluster.json svcinstall`

-   **Uninstall a Service:**
    Removes the `systemd` service.
    `sudo raftctl --config /etc/raftctl/local-cluster.json svcuninstall`

## Example Workflow: Creating a 2-Node Cluster Service

1.  **Install `raftctl` globally.**

2.  **Create the configuration directory:** `sudo mkdir -p /etc/raftctl`

3.  **Create a multi-node cluster configuration file** at `/etc/raftctl/local-cluster.json`.

4.  **Create single-node "pointer" files.** These are needed to query individual nodes with the `state` command.
    *   `/etc/raftctl/node1.json` (containing only the object for the node at port 8089)
    *   `/etc/raftctl/node2.json` (containing only the object for the node at port 8090)

5.  **Install the cluster service:**
    ```bash
    sudo raftctl --config /etc/raftctl/local-cluster.json svcinstall
    # This creates ONE service called "raft-cluster-local"
    ```

6.  **Start the entire cluster with one command:**
    ```bash
    sudo systemctl start raft-cluster-local
    ```

7.  **Check the logs:**
    ```bash
    sudo tail -f /var/log/raft-daemon-1.log
    sudo tail -f /var/log/raft-daemon-2.log
    ```

8.  **Verify the final state of the individual nodes:**
    ```bash
    raftctl --config /etc/raftctl/node1.json state
    raftctl --config /etc/raftctl/node2.json state
    ```

9.  **Stop the entire cluster with one command:**
    ```bash
    sudo systemctl stop raft-cluster-local
    ```

## Scaling Considerations

-   **Raft Is Not for Massive Clusters:** The Raft protocol is very "chatty" and relies on a leader sending heartbeats to all followers. Performance degrades as the node count grows.
-   **Optimal Size:** Like other Raft-based systems (etcd, Consul), this tool is most effective for small, odd-numbered clusters (**3, 5, or 7 nodes**).
-   **Technical Limits:** This implementation uses persistent TCP connections between all nodes and runs on Node.js's single-threaded event loop. It is not designed to scale beyond a few dozen nodes.

## License

MIT License