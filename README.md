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

A simple JSON object. This format is used to define a single daemon. It is **required** when you want to target a specific node with the `join` command or install a single-node service.

**Example: `/etc/raftctl/node1-config.json`**
```json
{
  "address": "tcp://192.168.1.10:8089",
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

(This section remains the same)

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

-   **Check Node/Cluster State:**
    Connects to any running daemon to query its state. The behavior depends on the node's role:
    *   **If you target a FOLLOWER**, it will return its own state and the address of the leader.
    *   **If you target the LEADER**, it will return the state of every node in the entire cluster.

    `raftctl state [host] [port]`

    **Examples:**
    ```bash
    # Query a specific node directly
    raftctl state localhost 10000

    # Query the node defined in a config file
    raftctl --config /etc/raftctl/node1.json state
    ```

-   **Join a Cluster:**
    Tells a new node (defined in a config file) to join an existing cluster.
    `raftctl --config /etc/raftctl/new_node.json join tcp://existing-node-ip:8089`

### System Service Commands (`sudo` required)

(This section remains the same)

## Example Workflow: Creating a 2-Node Cluster Service

1.  **Install `raftctl` globally.**

2.  **Create the configuration directory:** `sudo mkdir -p /etc/raftctl`

3.  **Create a multi-node cluster configuration file** at `/etc/raftctl/local-cluster.json`.

4.  **Install the cluster service:**
    ```bash
    sudo raftctl --config /etc/raftctl/local-cluster.json svcinstall
    ```

5.  **Start the entire cluster with one command:**
    ```bash
    sudo systemctl start raft-cluster-local
    ```

6.  **Verify the final state of the individual nodes using the new `state` command:**
    ```bash
    # Check node 1
    raftctl state localhost 10000
    # Expected output: { "state": "LEADER" } (or FOLLOWER)

    # Check node 2
    raftctl state localhost 10001
    # Expected output: { "state": "FOLLOWER" } (or LEADER)
    ```

7.  **Stop the entire cluster with one command:**
    ```bash
    sudo systemctl stop raft-cluster-local
    ```

## Scaling Considerations

(This section remains the same)

## License

MIT License