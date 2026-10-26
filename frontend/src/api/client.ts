import { User, MCPConfig, Dashboard, DashboardWidget, DashboardComment, ChatSession, ChatMessage, AgentPersona, LocalRepository, DatasetProposal, UserInquiry } from '../types';

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
  },
  listUsers: (): Promise<Array<{ id: number; email: string; role: string; status: string; created_at?: string }>> =>
    request('/api/auth/users'),
  createUser: (data: { email: string; password?: string; role: string }) =>
    request<{ id: number; email: string; role: string; status: string }>('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateUserRole: (userId: number, role: string) =>
    request<{ id: number; email: string; role: string; status: string }>(`/api/auth/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),
  deleteUser: (userId: number) =>
    request<{ status: string; id: number }>(`/api/auth/users/${userId}`, {
      method: 'DELETE',
    }),
};

// MCP Management
export const mcpApi = {
  list: (): Promise<MCPConfig[]> => request<MCPConfig[]>('/api/mcp'),
  create: (data: { name: string; description?: string; scope: string; transport: string; url: string; auth_header?: string }) =>
    request<{ message: string; id: number }>('/api/mcp', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: { name: string; description?: string; scope: string; transport: string; url: string; auth_header?: string }) =>
    request<{ message: string; id: number }>(`/api/mcp/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  toggle: (id: number) => request<{ id: number; is_active: boolean }>(`/api/mcp/${id}/toggle`, { method: 'PUT' }),
  delete: (id: number) => request<{ message: string }>(`/api/mcp/${id}`, { method: 'DELETE' }),
  test: (data: { url: string; transport: string; auth_header?: string; mcp_id?: number }) =>
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
  getRepositoryBranches: (repoId: number) =>
    request<{ repo_id: number; name: string; current_branch: string; branches: string[] }>(
      `/api/agents/repositories/${repoId}/branches`
    ),
  switchRepositoryBranch: (repoId: number, branch: string) =>
    request<{ message: string; current_branch: string; head_sha: string; commit_count: number }>(
      `/api/agents/repositories/${repoId}/branch`,
      {
        method: 'POST',
        body: JSON.stringify({ branch }),
      }
    ),
  cloneRepositoryStream: async (
    data: { name: string; remote_url: string; clone_type?: string; default_branch?: string },
    onProgress: (event: { stage: string; percent: number; detail: string; repo_id?: number }) => void
  ) => {
    const token = localStorage.getItem('antigravity_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/agents/repositories/clone-stream', {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({ detail: 'Failed to initiate clone stream' }));
      throw new Error(errJson.detail || 'Clone failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('ReadableStream not supported');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            onProgress(parsed);
          } catch {
            // ignore non-json
          }
        }
      }
    }
  },
};

// Dashboard Management
export const dashboardApi = {
  list: (scope?: 'all' | 'my' | 'public'): Promise<any[]> =>
    request(`/api/dashboards${scope ? `?scope=${scope}` : ''}`),
  get: (id: string): Promise<Dashboard> => request<Dashboard>(`/api/dashboards/${id}`),
  create: (data: { title: string; description?: string; datasources?: any[]; sources?: any[] }) =>
    request<{ id: string; title: string }>('/api/dashboards', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  duplicate: (dashboardId: string) =>
    request<{ id: string; title: string; widget_count: number }>(`/api/dashboards/${dashboardId}/duplicate`, {
      method: 'POST',
    }),
  delete: (dashboardId: string) =>
    request<{ success: boolean; id: string; message: string }>(`/api/dashboards/${dashboardId}`, {
      method: 'DELETE',
    }),
  toggleShare: (dashboardId: string, isPublic: boolean) =>
    request<{ id: string; is_public: boolean }>(`/api/dashboards/${dashboardId}/share`, {
      method: 'PUT',
      body: JSON.stringify({ is_public: isPublic }),
    }),
  updateSources: (dashboardId: string, sources: any[]) =>
    request<{ id: string; datasources: any[] }>(`/api/dashboards/${dashboardId}/sources`, {
      method: 'PUT',
      body: JSON.stringify({ sources }),
    }),
  upsertWidget: (dashboardId: string, widget: { widget_id: string; title: string; widget_type: string; grid: any; spec: any; datasource?: any }) =>
    request<{ success: boolean; widget_id: string }>(`/api/dashboards/${dashboardId}/widgets`, {
      method: 'POST',
      body: JSON.stringify(widget),
    }),
  updateLayout: (dashboardId: string, layouts: Record<string, { x: number; y: number; w: number; h: number; pixel_height?: number; zone_id?: string | null }>) =>
    request<{ success: boolean }>(`/api/dashboards/${dashboardId}/layout`, {
      method: 'PUT',
      body: JSON.stringify({ layouts }),
    }),
  updateZones: (dashboardId: string, zones: any[]) =>
    request<{ id: string; zones: any[] }>(`/api/dashboards/${dashboardId}/zones`, {
      method: 'PUT',
      body: JSON.stringify({ zones }),
    }),
  refreshWidget: (dashboardId: string, widgetId: string): Promise<DashboardWidget> =>
    request<DashboardWidget>(`/api/dashboards/${dashboardId}/widgets/${widgetId}/refresh`, { method: 'POST' }),
  refreshDashboard: (dashboardId: string): Promise<{ success: boolean; message: string; widgets: DashboardWidget[]; synced_repos: any[] }> =>
    request(`/api/dashboards/${dashboardId}/refresh`, { method: 'POST' }),
  evaluateFilters: (dashboardId: string, filters: Record<string, any>, widgetIds?: string[]): Promise<{ success: boolean; filters: Record<string, any>; widgets: DashboardWidget[] }> =>
    request(`/api/dashboards/${dashboardId}/evaluate`, {
      method: 'POST',
      body: JSON.stringify({ filters, widget_ids: widgetIds }),
    }),
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
  addCommentReply: (dashboardId: string, commentId: number, content: string): Promise<{ id: number; replies: any[]; is_resolved: boolean }> =>
    request<{ id: number; replies: any[]; is_resolved: boolean }>(`/api/dashboards/${dashboardId}/comments/${commentId}/replies`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  deleteComment: (dashboardId: string, commentId: number): Promise<{ success: boolean }> =>
    request<{ success: boolean }>(`/api/dashboards/${dashboardId}/comments/${commentId}`, {
      method: 'DELETE',
    }),
  getCommentMessages: (dashboardId: string, commentId: number): Promise<ChatMessage[]> =>
    request<ChatMessage[]>(`/api/dashboards/${dashboardId}/comments/${commentId}/messages`),
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
    request<
      Array<{
        table_name: string;
        engine: string;
        row_count: number;
        columns?: string[];
        status: string;
        type: string;
        is_derived?: boolean;
        lineage?: {
          origin_type?: string;
          source_name?: string;
          derivation_summary?: string;
          source_query?: string;
          storage_path?: string;
        };
      }>
    >('/api/duckdb/datasets'),
  uploadDataset: async (file: File, tableName?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    if (tableName) formData.append('table_name', tableName);
    const token = localStorage.getItem('antigravity_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch('/api/duckdb/upload', {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: 'Upload failed' }));
      throw new Error(err.detail || 'Upload failed');
    }
    return res.json();
  },
  importDiskDataset: (path: string, tableName?: string) =>
    request<{ status: string; table_name: string; row_count: number; columns: string[] }>(
      '/api/duckdb/import-disk',
      {
        method: 'POST',
        body: JSON.stringify({ path, table_name: tableName }),
      }
    ),
  deleteDataset: (tableName: string) =>
    request<{ status: string; message: string }>(`/api/duckdb/datasets/${tableName}`, {
      method: 'DELETE',
    }),
};

// Chat Sessions & SSE Streaming
export const chatApi = {
  listSessions: (dashboardId?: string): Promise<ChatSession[]> =>
    request<ChatSession[]>(`/api/chat/sessions${dashboardId ? `?dashboard_id=${encodeURIComponent(dashboardId)}` : ''}`),
  createSession: (title?: string, dashboardId?: string | null): Promise<ChatSession> =>
    request<ChatSession>('/api/chat/sessions', { method: 'POST', body: JSON.stringify({ title, dashboard_id: dashboardId }) }),
  forkSession: (
    sessionId: string,
    payload?: { message_id?: number; title?: string }
  ): Promise<ChatSession> =>
    request<ChatSession>(`/api/chat/sessions/${sessionId}/fork`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  attachDashboard: (sessionId: string, dashboardId: string | null): Promise<{ id: string; dashboard_id: string | null; dashboard_title: string | null }> =>
    request(`/api/chat/sessions/${sessionId}/dashboard`, { method: 'PUT', body: JSON.stringify({ dashboard_id: dashboardId }) }),
  getMessages: (sessionId: string): Promise<ChatMessage[]> =>
    request<ChatMessage[]>(`/api/chat/sessions/${sessionId}/messages`),
  deleteSession: (sessionId: string): Promise<{ message: string }> =>
    request<{ message: string }>(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' }),
  stopSession: (sessionId: string): Promise<{ session_id: string; stopped: boolean }> =>
    request<{ session_id: string; stopped: boolean }>(`/api/chat/sessions/${sessionId}/stop`, { method: 'POST' }),
  getRuntimeInfo: (): Promise<{
    default_provider: string;
    opencode_model: string;
    antigravity_model: string;
    antigravity_base_url?: string;
    providers: Array<{ id: string; label: string; model: string; base_url?: string }>;
  }> => request('/api/chat/runtime'),
  confirmProposal: (payload: {
    proposal_id: string;
    action: 'approve' | 'decline';
    table_name: string;
    sql_query?: string;
    records?: Record<string, any>[];
    description?: string;
  }): Promise<{ status: string; proposal_id: string; table_name: string; message: string; result?: any }> =>
    request('/api/chat/proposals/confirm', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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
      onProposal?: (proposal: DatasetProposal) => void;
      onInquiry?: (inquiry: UserInquiry) => void;
      onDone: () => void;
      onError: (err: any) => void;
    },
    options?: {
      agentId?: string;
      scope?: string;
      pinId?: number;
      widgetId?: string;
      provider?: string;
      endpoint?: string;
      base_url?: string;
      model?: string;
      parentSessionId?: string;
      signal?: AbortSignal;
    } | string
  ) => {
    const token = getAuthToken();
    const agentId = typeof options === 'string' ? options : options?.agentId || 'github-agent';
    const scope = typeof options === 'object' ? options?.scope : undefined;
    const pinId = typeof options === 'object' ? options?.pinId : undefined;
    const widgetId = typeof options === 'object' ? options?.widgetId : undefined;
    const provider = typeof options === 'object' ? options?.provider : undefined;
    const endpoint = typeof options === 'object' ? (options?.base_url || options?.endpoint) : undefined;
    const model = typeof options === 'object' ? options?.model : undefined;
    const parentSessionId = typeof options === 'object' ? options?.parentSessionId : undefined;
    const signal = typeof options === 'object' ? options?.signal : undefined;

    try {
      const response = await fetch(`/api/chat/sessions/${sessionId}/stream`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message,
          dashboard_id: dashboardId,
          agent_id: agentId,
          scope,
          pin_id: pinId,
          widget_id: widgetId,
          provider,
          endpoint,
          base_url: endpoint,
          model,
          parent_session_id: parentSessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat error: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let doneDispatched = false;

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
              } else if (event.type === 'dataset_proposal') {
                callbacks.onProposal?.(event.proposal);
              } else if (event.type === 'user_inquiry') {
                callbacks.onInquiry?.(event.inquiry);
              } else if (event.type === 'done') {
                if (!doneDispatched) {
                  doneDispatched = true;
                  callbacks.onDone();
                }
              }
            } catch (err) {
              console.error('Error parsing SSE event:', err);
            }
          }
        }
      }
      if (!doneDispatched) {
        doneDispatched = true;
        callbacks.onDone();
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        callbacks.onDone();
        return;
      }
      callbacks.onError(err);
    }
  },
};
