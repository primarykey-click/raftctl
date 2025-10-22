
# RaftCTL - A Node.js Raft Consensus Daemon

RaftCTL is a command-line application that runs a consensus daemon using the Raft protocol. It is designed to be a lightweight, configurable, and easy-to-use tool for creating small, highly-available clusters. It uses a modified, local version of the `liferaft` library for the consensus algorithm and provides a CLI for interaction and system service management.

## Key Features

- **Raft Consensus:** Implements the Raft consensus algorithm to ensure a single leader and consistent state across nodes.
- **Auto-Clustering:** Nodes can automatically discover and join each other on startup using a shared list of cluster members.
- **Smart Join with Leader Discovery:** A new node can join the cluster by contacting any member, which will intelligently forward it to the current leader.
- **Event-Driven Scripting:** Execute custom `.js` scripts in response to Raft events like a node becoming a `leader` or `follower`.
- **Systemd Service Management:** Includes commands to install, uninstall, and manage the daemon as a Linux `systemd` service for robust, production use.
- **Global CLI:** Can be installed globally, providing a system-wide `raftctl` command for managing nodes.
- **Configurable Logging:** All daemon output can be redirected to a configurable log file.

## Prerequisites

- **Node.js** (v16.x or later recommended)
- **npm** (comes with Node.js)
- **Linux** (for `systemd` service management)

## Installation

The application is designed to be installed as a global command-line tool.

1.  **Clone the repository (or create the project files):**
    ```bash
    # Make sure all the files (index.js, liferaft.js, package.json, etc.)
    # are in a directory.
    cd /path/to/your/project
    ```

2.  **Make the script executable:**
    ```bash
    chmod +x index.js
    ```

3.  **Install Dependencies:**
    ```bash
    npm install
    ```

4.  **Link for Development (Recommended):**
    Use `npm link` to create a global `raftctl` command that points to your local source code. This is ideal for testing, as any changes you make are reflected immediately.
    ```bash
    npm link
    ```

5.  **Global Install (Production):**
    Alternatively, install the package globally from the project's root directory.
    ```bash
    npm install -g .
    ```

## Configuration

RaftCTL is configured using JSON files. By convention, these are stored in `/etc/raftctl/`.

**Step 1: Create the configuration directory:**
```bash
sudo mkdir -p /etc/raftctl
```

**Step 2: Create a configuration file for each node.**

Each node in the cluster requires its own unique configuration file.

**Example: `/etc/raftctl/node1.json`**
```json
{
  "address": "tcp://localhost:8089",
  "command_port": 10000,
  "serviceName": "raft-daemon-1",
  "logFile": "/var/log/raft-daemon-1.log",
  "election min": "200 millisecond",
  "election max": "1 second",
  "events": {
    "leader": "/etc/raftctl/scripts/on_leader.js",
    "follower": "/etc/raftctl/scripts/on_follower.js"
  },
  "clusterNodes": [
    "tcp://localhost:8089",
    "tcp://localhost:8090"
  ]
}
```

### Configuration Options

| Option           | Type     | Description                                                                                             |
| :--------------- | :------- | :------------------------------------------------------------------------------------------------------ |
| `address`        | `String` | The unique `tcp://hostname:port` for this node's Raft communication.                                    |
| `command_port`   | `Number` | A unique TCP port for the CLI to send commands to this daemon.                                          |
| `serviceName`    | `String` | A unique name for the `systemd` service. Used for `svcinstall`.                                         |
| `logFile`        | `String` | Absolute path to the log file where all daemon output will be written.                                  |
| `election min`   | `String` | The minimum timeout before a follower will start a new election (e.g., `"150 ms"`).                       |
| `election max`   | `String` | The maximum timeout before a follower will start a new election. A random value between min/max is used. |
| `events`         | `Object` | Maps Raft events (`leader`, `follower`, `candidate`) to JS scripts that will be executed.               |
| `clusterNodes`   | `Array`  | An array of Raft addresses for all initial nodes in the cluster. Used for auto-joining on startup.      |

## Command-Line Interface (CLI)

Once installed globally, all commands are run using `raftctl`.

**Important:** Because each daemon has a unique configuration, you must always specify which node you are targeting using the `--config` flag.

### General Commands

-   **Get Help:**
    ```bash
    raftctl --help
    ```

-   **Start a Daemon (Manual):**
    Starts a daemon in the foreground. All output goes to the console unless a `logFile` is configured.
    ```bash
    raftctl --config /etc/raftctl/node1.json start
    ```

-   **Check Node State:**
    Connects to the running daemon and prints its current Raft state (LEADER, FOLLOWER, etc.).
    ```bash
    raftctl --config /etc/raftctl/node1.json state
    ```

-   **Join a Cluster:**
    Tells a new node to join an existing cluster by contacting any member.
    ```bash
    raftctl --config /etc/raftctl/new_node.json join tcp://existing-node-ip:8089
    ```

### System Service Commands (`sudo` required)

-   **Install as a Service:**
    Creates and registers a `systemd` service for the specified node configuration.
    ```bash
    sudo raftctl --config /etc/raftctl/node1.json svcinstall
    ```

-   **Uninstall a Service:**
    Removes the `systemd` service.
    ```bash
    sudo raftctl --config /etc/raftctl/node1.json svcuninstall
    ```

## Example Workflow: Creating a 2-Node Cluster

1.  **Install `raftctl` globally** using `npm link` or `npm install -g .`.

2.  **Create the configuration directory:**
    ```bash
    sudo mkdir -p /etc/raftctl
    ```

3.  **Create `/etc/raftctl/node1.json` and `/etc/raftctl/node2.json`** as shown in the Configuration section above. Ensure they have different `address`, `command_port`, `serviceName`, and `logFile` values.

4.  **Install the services:**
    ```bash
    sudo raftctl --config /etc/raftctl/node1.json svcinstall
    sudo raftctl --config /etc/raftctl/node2.json svcinstall
    ```

5.  **Start the services:**
    ```bash
    sudo systemctl start raft-daemon-1
    sudo systemctl start raft-daemon-2
    ```
    The nodes will start, use the `clusterNodes` list to find each other, one will be elected leader, and the other will become a follower.

6.  **Check the logs to see the activity:**
    ```bash
    sudo tail -f /var/log/raft-daemon-1.log
    sudo tail -f /var/log/raft-daemon-2.log
    ```

7.  **Verify the final state of the cluster:**
    ```bash
    # Check node 1
    raftctl --config /etc/raftctl/node1.json state
    # Expected output: { "state": "LEADER" } (or FOLLOWER)

    # Check node 2
    raftctl --config /etc/raftctl/node2.json state
    # Expected output: { "state": "FOLLOWER" } (or LEADER)
    ```

## Scaling Considerations

-   **Raft Is Not for Massive Clusters:** The Raft protocol is very "chatty" and relies on a leader sending heartbeats to all followers. Performance degrades as the node count grows.
-   **Optimal Size:** Like other Raft-based systems (etcd, Consul), this tool is most effective for small, odd-numbered clusters (**3, 5, or 7 nodes**).
-   **Technical Limits:** This implementation uses persistent TCP connections between all nodes and runs on Node.js's single-threaded event loop. It is not designed to scale beyond a few dozen nodes.

## License

MIT License

