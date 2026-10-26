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
  is_cloned?: boolean;
  last_synced_at?: string;
}

export interface MCPConfig {
  id: number;
  name: string;
  description?: string;
  scope: 'global' | 'user';
  transport: 'sse' | 'http' | 'streamable_http';
  url: string;
  has_auth: boolean;
  is_active: boolean;
  is_owner: boolean;
  created_at?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  agent_id?: string | null;
  status?: 'idle' | 'running' | 'stopping' | 'awaiting_permission' | 'timed_out' | 'failed' | 'completed';
  last_error?: string | null;
  dashboard_id?: string | null;
  dashboard_title?: string | null;
  scope?: 'global' | 'dashboard' | 'pin';
  pin_id?: number | null;
  widget_id?: string | null;
  parent_session_id?: string | null;
  parent_title?: string | null;
  fork_message_id?: number | null;
  created_at?: string;
  updated_at?: string;
  message_count: number;
}

export interface ToolCallTrace {
  name: string;
  args?: Record<string, any>;
  result?: Record<string, any>;
  status?: 'running' | 'completed' | 'error';
}

export interface DatasetProposal {
  id: string;
  type: 'dataset';
  table_name: string;
  sql_query: string;
  description?: string;
  rationale?: string;
  preview_row_count?: number;
  columns?: string[];
  sample_rows?: Record<string, any>[];
  records?: Record<string, any>[];
  status: 'pending' | 'approved' | 'declined';
  result?: Record<string, any>;
}

export interface UserInquiry {
  id: string;
  type?: string;
  question: string;
  options: string[];
  context?: string;
  selected_option?: string;
  command?: string;
  repo?: string;
  file_path?: string;
  rationale?: string;
  status?: string;
}

export interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thoughts?: string;
  tool_calls?: ToolCallTrace[];
  proposals?: DatasetProposal[];
  inquiries?: UserInquiry[];
  created_at?: string;
}

export interface WidgetGrid {
  x: number;
  y: number;
  w: number;
  h: number;
  pixel_height?: number;
  zone_id?: string | null;
}

export interface WidgetSource {
  id?: string;
  type: string;
  label: string;
  ref?: string;
}

export interface CommentReply {
  id: string;
  user_email: string;
  content: string;
  created_at?: string;
}

export interface DashboardComment {
  id: number;
  dashboard_id: string;
  widget_id?: string | null;
  user_email: string;
  content: string;
  replies?: CommentReply[];
  pos_x: number;
  pos_y: number;
  is_resolved: boolean;
  chat_session_id?: string | null;
  created_at?: string;
}

export interface FilterScope {
  date?: boolean;
  region?: boolean;
  repo?: boolean;
  env?: boolean;
}

export type SingleFilterType =
  | 'dropdown'
  | 'multi_dropdown'
  | 'checkbox'
  | 'radio'
  | 'range'
  | 'top_n'
  | 'search_text'
  | 'date_picker'
  | 'toggle';

export interface SingleFilterOption {
  label: string;
  value: string;
  count?: number;
}

export interface SingleFilterSpec {
  filter_type: SingleFilterType;
  field: string;
  label: string;
  target_widget_ids?: string[];
  source_info?: {
    type?: 'widget_dimension' | 'duckdb_table';
    widget_id?: string;
    series_name?: string;
    axis?: 'x' | 'y' | 'pie' | 'table';
    table?: string;
    column?: string;
  };
  options?: Array<SingleFilterOption | string>;
  value?: string;
  selected_values?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  range_value?: [number, number];
  top_n_count?: number;
  top_n_dir?: 'top' | 'bottom';
  search_query?: string;
  search_mode?: 'contains' | 'starts_with' | 'exact';
  toggle_enabled?: boolean;
  toggle_mode?: 'exclude_max' | 'non_zero';
  date_start?: string;
  date_end?: string;
  preset?: string;
}

export interface DashboardWidget {
  id: string;
  title: string;
  widget_type: 'echarts' | 'metric_card' | 'table' | 'text_audit' | 'react_app' | 'filter';
  grid: WidgetGrid;
  spec: Record<string, any> & {
    filter_scope?: FilterScope;
    excluded_filters?: string[];
  };
  datasource?: {
    type: string;
    label?: string;
    file_id?: string;
    query?: string;
    sql?: string;
  };
  datasources?: WidgetSource[];
  updated_at?: string;
}

export interface DashboardZone {
  id: string;
  title: string;
  description?: string;
  color?: string;
  collapsed?: boolean;
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
  datasources?: WidgetSource[];
  zones?: DashboardZone[];
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
  datasources?: WidgetSource[];
}

export interface DatasetFile {
  id: string;
  filename: string;
  file_size: number;
  mime_type: string;
  description?: string;
  created_at?: string;
}
