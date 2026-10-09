# Run all recipes from the repository root.

# Develop the web UI with sample board data and automatic reload.
dev port="5173":
    pnpm --dir web install --frozen-lockfile
    pnpm --dir web dev --mode mock --port {{port}}

# Build the web UI before the Rust CLI, which embeds the UI assets.
build:
    pnpm --dir web install --frozen-lockfile
    pnpm --dir web build
    cargo build

# Install the current checkout's CLI and embedded web UI globally.
install:
    pnpm --dir web install --frozen-lockfile
    pnpm --dir web build
    cargo install --path . --locked --force

# Watch the saved board server and serve the web UI with HMR.
serve port="7420" backend_port="7421": build
    #!/usr/bin/env bash
    set -euo pipefail
    if ! command -v watchexec >/dev/null 2>&1; then
        echo "Install Watchexec with: cargo install --locked watchexec-cli" >&2
        exit 1
    fi
    if ( : >/dev/tcp/127.0.0.1/{{port}} ) 2>/dev/null; then
        echo "Web port {{port}} is already in use." >&2
        exit 1
    fi
    if ( : >/dev/tcp/127.0.0.1/{{backend_port}} ) 2>/dev/null; then
        echo "Rust API port {{backend_port}} is already in use." >&2
        exit 1
    fi
    watchexec --watch src --watch Cargo.toml --watch Cargo.lock --watch build.rs --restart -- cargo run -- serve --port "{{backend_port}}" &
    watcher=$!
    trap 'kill "$watcher" 2>/dev/null || true; wait "$watcher" 2>/dev/null || true' EXIT
    for attempt in {1..120}; do
        if curl --silent --fail "http://127.0.0.1:{{backend_port}}/api/health" >/dev/null; then
            break
        fi
        if ! kill -0 "$watcher" 2>/dev/null; then
            echo "Watchexec stopped before the server started." >&2
            exit 1
        fi
        sleep 0.25
    done
    if ! curl --silent --fail "http://127.0.0.1:{{backend_port}}/api/health" >/dev/null; then
        echo "The Rust server did not start." >&2
        exit 1
    fi
    SKAN_BACKEND_PORT="{{backend_port}}" SKAN_WEB_PORT="{{port}}" pnpm --dir web dev --mode live --host 127.0.0.1 --port "{{port}}" --strictPort
