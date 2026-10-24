export interface User {
  id: number;
  email: string;
  role: string;
}

export interface AgentPersona {
  id: string;
  name: string;
  role_description: string;
  icon: string;
  system_instructions: string;
  is_default: boolean;
  updated_at?: string;
}

export interface LocalRepository {
  id: number;
  name: string;
  remote_url: string;
  local_path: string;
  clone_type: string;
  default_branch: string;
  last_synced_at?: string;
}

export interface MCPConfig {
  id: number;
  name: string;
  description?: string;
  scope: 'global' | 'user';
  transport: 'sse' | 'http';
  url: string;
  has_auth: boolean;
  is_active: boolean;
  is_owner: boolean;
  created_at?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at?: string;
  updated_at?: string;
  message_count: number;
}

export interface ToolCallTrace {
  name: string;
  args?: Record<string, any>;
  result?: Record<string, any>;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thoughts?: string;
  tool_calls?: ToolCallTrace[];
  created_at?: string;
}

export interface WidgetGrid {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetSource {
  id?: string;
  type: string;
  label: string;
  ref?: string;
}

export interface DashboardComment {
  id: number;
  dashboard_id: string;
  widget_id?: string | null;
  user_email: string;
  content: string;
  pos_x: number;
  pos_y: number;
  is_resolved: boolean;
  created_at?: string;
}

export interface FilterScope {
  date?: boolean;
  region?: boolean;
  repo?: boolean;
  env?: boolean;
}

export interface DashboardWidget {
  id: string;
  title: string;
  widget_type: 'echarts' | 'metric_card' | 'table' | 'text_audit' | 'react_app';
  grid: WidgetGrid;
  spec: Record<string, any> & {
    filter_scope?: FilterScope;
    excluded_filters?: string[];
  };
  datasource?: {
    type: string;
    label?: string;
    file_id?: string;
  };
  datasources?: WidgetSource[];
  updated_at?: string;
}

export interface Dashboard {
  id: string;
  title: string;
  description?: string;
  is_default: boolean;
  is_public?: boolean;
  is_owner?: boolean;
  owner_email?: string;
  widgets: DashboardWidget[];
}

export interface DashboardListItem {
  id: string;
  title: string;
  description?: string;
  is_default: boolean;
  is_public: boolean;
  is_owner: boolean;
  owner_email: string;
  widget_count: number;
  created_at?: string;
}

export interface DatasetFile {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  description?: string;
  created_at?: string;
}
