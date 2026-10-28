import { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { getAuthToken } from '../../api/client';
import { WifiOff } from 'lucide-react';

export interface InteractiveTerminalRef {
  runCommand: (cmd: string) => void;
  clear: () => void;
  restart: () => void;
  focus: () => void;
}

interface InteractiveTerminalProps {
  repoId: number;
  worktreePath?: string | null;
  worktreeBranch?: string;
  assignedPort?: number | null;
  height?: number;
  onStatusChange?: (connected: boolean) => void;
}

export const InteractiveTerminal = forwardRef<InteractiveTerminalRef, InteractiveTerminalProps>(
  ({ repoId, worktreePath, height, onStatusChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [connecting, setConnecting] = useState(true);

    const connectWebSocket = () => {
      if (!repoId) return;

      // Close previous connection if active
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setConnecting(true);
      const token = getAuthToken() || '';
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wtParam = worktreePath ? `&worktree_path=${encodeURIComponent(worktreePath)}` : '';
      const url = `${proto}//${window.location.host}/api/agents/repositories/${repoId}/terminal/pty?token=${encodeURIComponent(token)}${wtParam}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setConnecting(false);
        onStatusChange?.(true);

        // Notify backend of current terminal geometry
        if (terminalRef.current && fitAddonRef.current) {
          try {
            fitAddonRef.current.fit();
            ws.send(
              JSON.stringify({
                type: 'resize',
                cols: terminalRef.current.cols,
                rows: terminalRef.current.rows,
              })
            );
          } catch {
            // ignore
          }
        }
      };

      ws.onmessage = (event) => {
        if (terminalRef.current) {
          terminalRef.current.write(event.data);
        }
      };

      ws.onerror = (err) => {
        console.warn('Terminal WebSocket warning/error:', err);
      };

      ws.onclose = () => {
        setConnected(false);
        setConnecting(false);
        onStatusChange?.(false);
      };
    };

    // Initialize xterm.js instance
    useEffect(() => {
      if (!containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.25,
        letterSpacing: 0,
        scrollback: 5000,
        theme: {
          background: '#0d0f17',
          foreground: '#e2e8f0',
          cursor: '#818cf8',
          cursorAccent: '#0d0f17',
          selectionBackground: 'rgba(99, 102, 241, 0.35)',
          black: '#1e293b',
          red: '#f87171',
          green: '#4ade80',
          yellow: '#facc15',
          blue: '#60a5fa',
          magenta: '#c084fc',
          cyan: '#38bdf8',
          white: '#f8fafc',
          brightBlack: '#475569',
          brightRed: '#ef4444',
          brightGreen: '#22c55e',
          brightYellow: '#eab308',
          brightBlue: '#3b82f6',
          brightMagenta: '#a855f7',
          brightCyan: '#06b6d4',
          brightWhite: '#ffffff',
        },
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      try {
        fitAddon.fit();
      } catch {
        // ignore
      }

      // Stream user keystrokes to PTY
      term.onData((data) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Stream terminal resize events to PTY
      term.onResize(({ cols, rows }) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      // Connect to backend WebSocket
      connectWebSocket();

      // Observe container size changes
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch {
            // ignore
          }
        }
      });
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        if (wsRef.current) {
          wsRef.current.close();
          wsRef.current = null;
        }
        term.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    }, [repoId, worktreePath]);

    // Handle container height change
    useEffect(() => {
      const timer = window.setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit();
          } catch {
            // ignore
          }
        }
      }, 50);
      return () => window.clearTimeout(timer);
    }, [height]);

    // Expose imperative API
    useImperativeHandle(ref, () => ({
      runCommand: (cmd: string) => {
        const cleanCmd = cmd.trim();
        if (!cleanCmd) return;
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'input', data: `${cleanCmd}\r` }));
        }
        terminalRef.current?.focus();
      },
      clear: () => {
        terminalRef.current?.clear();
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'clear' }));
        }
      },
      restart: () => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'restart' }));
        } else {
          connectWebSocket();
        }
        terminalRef.current?.focus();
      },
      focus: () => {
        terminalRef.current?.focus();
      },
    }));

    return (
      <div className="relative w-full h-full flex flex-col bg-[#0d0f17] overflow-hidden select-text">
        {/* Connection status overlay if disconnected */}
        {!connected && !connecting && (
          <div className="absolute top-2 right-3 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-mono">
            <WifiOff className="w-3 h-3" />
            <span>Disconnected</span>
            <button
              onClick={connectWebSocket}
              className="ml-1 underline hover:text-white cursor-pointer"
            >
              Reconnect
            </button>
          </div>
        )}

        {/* xterm canvas container */}
        <div
          ref={containerRef}
          className="flex-1 w-full h-full p-2.5 overflow-hidden"
          onClick={() => terminalRef.current?.focus()}
        />
      </div>
    );
  }
);
InteractiveTerminal.displayName = 'InteractiveTerminal';
