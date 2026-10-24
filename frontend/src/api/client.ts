import { User, MCPConfig, Dashboard, DashboardWidget, DashboardComment, ChatSession, ChatMessage, AgentPersona, LocalRepository } from '../types';

const TOKEN_KEY = 'antigravity_token';

export const getAuthToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setAuthToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearAuthToken = (): void => localStorage.removeItem(TOKEN_KEY);

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorDetail = 'API request failed';
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.detail || errorJson.error || errorDetail;
    } catch {
      errorDetail = response.statusText;
    }
    throw new Error(errorDetail);
  }

  return response.json() as Promise<T>;
}

// Authentication
export const authApi = {
  login: async (email: string, password: string): Promise<{ access_token: string; user: User }> => {
    const res = await request<{ access_token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.access_token);
    return res;
  },
  me: async (): Promise<User> => {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    return request<User>('/api/auth/me');
  },
  logout: () => {
    clearAuthToken();
  }
};

// MCP Management
export const mcpApi = {
  list: (): Promise<MCPConfig[]> => request<MCPConfig[]>('/api/mcp'),
  create: (data: { name: string; description?: string; scope: string; transport: string; url: string; auth_header?: string }) =>
    request<{ message: string; id: number }>('/api/mcp', { method: 'POST', body: JSON.stringify(data) }),
  toggle: (id: number) => request<{ id: number; is_active: boolean }>(`/api/mcp/${id}/toggle`, { method: 'PUT' }),
  delete: (id: number) => request<{ message: string }>(`/api/mcp/${id}`, { method: 'DELETE' }),
  test: (data: { url: string; transport: string; auth_header?: string }) =>
    request<{ success: boolean; status_code: number; message: string; preview?: string }>('/api/mcp/test', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getTools: () => request<any[]>('/api/mcp/tools'),
};

// Agent Personas & Repositories
export const agentApi = {
  listPersonas: (): Promise<AgentPersona[]> => request<AgentPersona[]>('/api/agents'),
  createPersona: (data: { name: string; role_description: string; icon?: string; system_instructions: string }) =>
    request<{ message: string; id: string }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deletePersona: (agentId: string) =>
    request<{ message: string }>(`/api/agents/${agentId}`, { method: 'DELETE' }),
  updateInstructions: (agentId: string, systemInstructions: string) =>
    request<{ id: string; system_instructions: string }>(`/api/agents/${agentId}/instructions`, {
      method: 'PUT',
      body: JSON.stringify({ system_instructions: systemInstructions }),
    }),
  listRepositories: (): Promise<LocalRepository[]> => request<LocalRepository[]>('/api/agents/repositories'),
  registerRepository: (data: { name: string; remote_url: string; clone_type?: string; default_branch?: string }) =>
    request<{ message: string; id: number; local_path: string }>('/api/agents/repositories', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  syncRepository: (repoId: number) =>
    request<{ message: string; last_synced_at: string }>(`/api/agents/repositories/${repoId}/sync`, {
      method: 'POST',
    }),
  deleteRepository: (repoId: number) =>
    request<{ message: string }>(`/api/agents/repositories/${repoId}`, {
      method: 'DELETE',
    }),
};

// Dashboard Management
export const dashboardApi = {
  list: (scope?: 'all' | 'my' | 'public'): Promise<any[]> =>
    request(`/api/dashboards${scope ? `?scope=${scope}` : ''}`),
  get: (id: string): Promise<Dashboard> => request<Dashboard>(`/api/dashboards/${id}`),
  create: (data: { title: string; description?: string }) =>
    request<{ id: string; title: string }>('/api/dashboards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  toggleShare: (dashboardId: string, isPublic: boolean) =>
    request<{ id: string; is_public: boolean }>(`/api/dashboards/${dashboardId}/share`, {
      method: 'PUT',
      body: JSON.stringify({ is_public: isPublic }),
    }),
  upsertWidget: (dashboardId: string, widget: { widget_id: string; title: string; widget_type: string; grid: any; spec: any; datasource?: any }) =>
    request<{ success: boolean; widget_id: string }>(`/api/dashboards/${dashboardId}/widgets`, {
      method: 'POST',
      body: JSON.stringify(widget),
    }),
  updateLayout: (dashboardId: string, layouts: Record<string, { x: number; y: number; w: number; h: number }>) =>
    request<{ success: boolean }>(`/api/dashboards/${dashboardId}/layout`, {
      method: 'PUT',
      body: JSON.stringify({ layouts }),
    }),
  refreshWidget: (dashboardId: string, widgetId: string): Promise<DashboardWidget> =>
    request<DashboardWidget>(`/api/dashboards/${dashboardId}/widgets/${widgetId}/refresh`, { method: 'POST' }),
  deleteWidget: (dashboardId: string, widgetId: string) =>
    request<{ success: boolean }>(`/api/dashboards/${dashboardId}/widgets/${widgetId}`, { method: 'DELETE' }),
  getComments: (dashboardId: string): Promise<DashboardComment[]> =>
    request<DashboardComment[]>(`/api/dashboards/${dashboardId}/comments`),
  createComment: (
    dashboardId: string,
    comment: { widget_id?: string | null; content: string; pos_x: number; pos_y: number }
  ): Promise<DashboardComment> =>
    request<DashboardComment>(`/api/dashboards/${dashboardId}/comments`, {
      method: 'POST',
      body: JSON.stringify(comment),
    }),
  resolveComment: (dashboardId: string, commentId: number): Promise<{ id: number; is_resolved: boolean }> =>
    request<{ id: number; is_resolved: boolean }>(`/api/dashboards/${dashboardId}/comments/${commentId}/resolve`, {
      method: 'PUT',
    }),
  deleteComment: (dashboardId: string, commentId: number): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/dashboards/${dashboardId}/comments/${commentId}`, {
      method: 'DELETE',
    }),
};

// DuckDB Management
export const duckdbApi = {
  query: (sql: string, limit?: number, offset?: number) =>
    request<{
      columns: string[];
      row_count: number;
      total_rows: number;
      is_truncated: boolean;
      data: any[];
      sql: string;
      limit: number;
      offset: number;
    }>('/api/duckdb/query', {
      method: 'POST',
      body: JSON.stringify({ sql, limit, offset }),
    }),
  getDatasets: () =>
    request<Array<{ table_name: string; engine: string; row_count: number; status: string; type: string }>>('/api/duckdb/datasets'),
};

// Chat Sessions & SSE Streaming
export const chatApi = {
  listSessions: (): Promise<ChatSession[]> => request<ChatSession[]>('/api/chat/sessions'),
  createSession: (title?: string): Promise<{ id: string; title: string }> =>
    request('/api/chat/sessions', { method: 'POST', body: JSON.stringify({ title }) }),
  getMessages: (sessionId: string): Promise<ChatMessage[]> =>
    request<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages`),
  deleteSession: (sessionId: string): Promise<{ message: string }> =>
    request<{ message: string }>(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' }),

  streamPrompt: async (
    sessionId: string,
    message: string,
    dashboardId: string | undefined,
    callbacks: {
      onToken: (token: string) => void;
      onThought: (thought: string) => void;
      onToolCall: (call: any) => void;
      onToolResult: (result: any) => void;
      onCanvasAction: (action: { action: string; widget: DashboardWidget }) => void;
      onDone: () => void;
      onError: (err: any) => void;
    },
    agentId?: string
  ) => {
    const token = getAuthToken();
    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message, dashboard_id: dashboardId, agent_id: agentId || 'github-agent' }),
      });

      if (!response.ok) {
        throw new Error(`Chat error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.substring(6);
            try {
              const event = JSON.parse(jsonStr);
              if (event.type === 'token') {
                callbacks.onToken(event.content);
              } else if (event.type === 'thought') {
                callbacks.onThought(event.content);
              } else if (event.type === 'tool_call') {
                callbacks.onToolCall(event);
              } else if (event.type === 'tool_result') {
                callbacks.onToolResult(event);
              } else if (event.type === 'canvas_action') {
                callbacks.onCanvasAction(event);
              } else if (event.type === 'done') {
                callbacks.onDone();
              }
            } catch (err) {
              console.error('Error parsing SSE event:', err);
            }
          }
        }
      }
      callbacks.onDone();
    } catch (err) {
      callbacks.onError(err);
    }
  },
};
