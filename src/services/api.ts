import type {
  NodeData,
  ApiResponse,
  PublicInfo,
  HistoryRecord,
  LoadHistoryResponse,
  PingHistoryResponse,
  PingHistoryRecord,
  PingTask,
  PingTaskFull,
  Me,
} from "@/types/node";
import type { RpcNodeStatus, RpcNodeStatusMap } from "@/types/rpc";

export type HistoryQueryRange = {
  start: string;
  end: string;
};

type SiteConfig = {
  version?: string;
  is_public?: boolean | string;
  authorization?: boolean | string;
  site_title?: string;
  theme_options?: Record<string, unknown>;
  preferred_theme?: string;
  default_language?: string;
  frontend_ws_timeout_minutes?: number;
  long_history_points?: number;
  custom_ct_name?: string;
  custom_cu_name?: string;
  custom_cm_name?: string;
  custom_bd_name?: string;
  node_1_name?: string;
  node_2_name?: string;
  node_3_name?: string;
  node_4_name?: string;
};

type CfServer = Record<string, any>;

type CfSysConfig = {
  show_price?: boolean;
  show_expire?: boolean;
  show_tf?: boolean;
  show_three_net_details?: boolean;
  long_history_points?: number;
};

const HISTORY_HOURS = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168];
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

const PING_TASKS: Array<{ id: number; key: string; label: string }> = [
  { id: 1, key: "ct", label: "CT" },
  { id: 2, key: "cu", label: "CU" },
  { id: 3, key: "cm", label: "CM" },
  { id: 4, key: "bd", label: "BGP" },
  { id: 5, key: "node_1", label: "Node 1" },
  { id: 6, key: "node_2", label: "Node 2" },
  { id: 7, key: "node_3", label: "Node 3" },
  { id: 8, key: "node_4", label: "Node 4" },
];

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toFiniteOrNull = (value: unknown): number | null => {
  if (value === false || value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isEnabled = (value: unknown): boolean => value === true || value === "true" || value === 1 || value === "1";

const isFreePrice = (value: unknown): boolean => {
  const text = String(value ?? "").trim();
  return text === "0" || text === "0.00" || text === "-1";
};

const parseTrafficLimitBytes = (value: unknown): number => {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text || text === "0" || text === "UNLIMITED" || text === "INFINITY") return 0;
  const match = text.match(/^(-?[\d.]+)\s*(B|KB|MB|GB|TB|PB)?$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const units: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
    PB: 1024 ** 5,
  };
  return amount * (units[match[2] || "GB"] || 1024 ** 3);
};

const billingCycleDays = (value: unknown): number => {
  const cycle = String(value || "").trim().toLowerCase();
  const days: Record<string, number> = {
    month: 30,
    quarter: 90,
    half_year: 180,
    year: 365,
    two_years: 730,
    three_years: 1095,
    four_years: 1460,
    five_years: 1825,
  };
  return days[cycle] || 30;
};

const trafficLimitType = (value: unknown): NodeData["traffic_limit_type"] => {
  const type = String(value || "").trim().toLowerCase();
  if (type === "up" || type === "down" || type === "min" || type === "max" || type === "sum") return type;
  return "sum";
};

const parseLoadAverage = (value: unknown): [number, number, number] => {
  const parts = String(value || "")
    .trim()
    .split(/[\s,/]+/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
};

const parseGpu = (value: unknown): { name: string; usage: number } => {
  let parsed = value;
  if (typeof value === "string" && value.trim()) {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (!first || typeof first !== "object") return { name: "", usage: 0 };
  return {
    name: String((first as any).name || ""),
    usage: toNumber((first as any).info),
  };
};

const normalizeTimestamp = (value: unknown): string => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return new Date(parsed).toISOString();
  const date = new Date(value as any);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
};

const isServerOnline = (server: CfServer): boolean => {
  if (typeof server.is_online === "boolean") return server.is_online;
  const updated = Number(server.last_updated || server.timestamp || 0);
  return Number.isFinite(updated) && Date.now() - updated <= ONLINE_WINDOW_MS;
};

const megabytesToBytes = (value: unknown): number => Math.max(0, toNumber(value)) * 1024 * 1024;

const uptimeSeconds = (server: CfServer): number => {
  const boot = Number(server.boot_time);
  if (!Number.isFinite(boot) || boot <= 0) return 0;
  const bootMs = boot < 10_000_000_000 ? boot * 1000 : boot;
  return Math.max(0, Math.floor((Date.now() - bootMs) / 1000));
};

const getApiBase = (): string => {
  if (typeof document === "undefined") return "";
  const content = document.querySelector('meta[name="apiBase"]')?.getAttribute("content") || "";
  return content.split(",")[0]?.trim().replace(/\/$/, "") || "";
};

const getAuthHeaders = (): HeadersInit => {
  const headers: Record<string, string> = {};
  if (typeof localStorage === "undefined") return headers;
  const token = localStorage.getItem("jwt_token");
  const verified = localStorage.getItem("turnstile_verified");
  const turnstile = localStorage.getItem("turnstile_token");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (verified) headers["X-Turnstile-Verified"] = verified;
  if (turnstile) headers["X-Turnstile-Token"] = turnstile;
  return headers;
};

const nearestHistoryHours = (hours: number): number => {
  const value = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return HISTORY_HOURS.reduce((best, current) =>
    Math.abs(current - value) < Math.abs(best - value) ? current : best
  );
};

const rangeToHours = (range?: HistoryQueryRange | null): number => {
  if (!range?.start || !range?.end) return 24;
  const hours = (new Date(range.end).getTime() - new Date(range.start).getTime()) / 3_600_000;
  return Number.isFinite(hours) && hours > 0 ? hours : 24;
};

class ApiService {
  public useRpc = false;

  enableRpc() {
    this.useRpc = false;
  }

  disableRpc() {
    this.useRpc = false;
  }

  private async request<T>(path: string): Promise<T | null> {
    const response = await fetch(`${getApiBase()}${path}`, {
      headers: getAuthHeaders(),
      credentials: "include",
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data?.turnstile_verified && typeof localStorage !== "undefined") {
      localStorage.setItem("turnstile_verified", data.turnstile_verified);
      localStorage.removeItem("turnstile_token");
    }
    return data as T;
  }

  async getConfig(): Promise<SiteConfig | null> {
    return this.request<SiteConfig>("/api/config");
  }

  private mapNode(server: CfServer, sysConfig?: CfSysConfig): NodeData {
    const gpu = parseGpu(server.gpu_info);
    const trafficLimit = isEnabled(sysConfig?.show_tf) ? parseTrafficLimitBytes(server.traffic_limit) : 0;
    return {
      uuid: String(server.id || ""),
      name: String(server.name || "Unnamed"),
      cpu_name: String(server.cpu_info || ""),
      virtualization: "",
      arch: String(server.arch || ""),
      cpu_cores: toNumber(server.cpu_cores),
      os: String(server.os || ""),
      kernel_version: String(server.kernel_version || ""),
      gpu_name: gpu.name,
      region: String(server.region || ""),
      mem_total: megabytesToBytes(server.ram_total),
      swap_total: megabytesToBytes(server.swap_total),
      disk_total: megabytesToBytes(server.disk_total),
      weight: toNumber(server.sort_order),
      price: isEnabled(sysConfig?.show_price) && !isFreePrice(server.price) ? toNumber(server.price) : isFreePrice(server.price) ? -1 : 0,
      billing_cycle: billingCycleDays(server.billing_cycle),
      currency: String(server.currency || ""),
      expired_at: isEnabled(sysConfig?.show_expire) && server.expire_date ? String(server.expire_date) : null,
      auto_renewal: isEnabled(server.auto_renewal),
      group: String(server.server_group || ""),
      tags: String(server.tags || ""),
      public_remark: "",
      hidden: isEnabled(server.is_hidden),
      traffic_limit: trafficLimit || undefined,
      traffic_limit_type: trafficLimitType(server.traffic_calc_type),
      created_at: normalizeTimestamp(server.timestamp),
      updated_at: normalizeTimestamp(server.last_updated || server.timestamp),
    };
  }

  private mapStatus(server: CfServer): RpcNodeStatus {
    const [load, load5, load15] = parseLoadAverage(server.load_avg);
    const gpu = parseGpu(server.gpu_info);
    return {
      client: String(server.id || ""),
      time: normalizeTimestamp(server.last_updated || server.timestamp),
      cpu: toNumber(server.cpu),
      gpu: gpu.usage,
      ram: megabytesToBytes(server.ram_used),
      ram_total: megabytesToBytes(server.ram_total),
      swap: megabytesToBytes(server.swap_used),
      swap_total: megabytesToBytes(server.swap_total),
      load,
      load5,
      load15,
      temp: 0,
      disk: megabytesToBytes(server.disk_used),
      disk_total: megabytesToBytes(server.disk_total),
      net_in: toNumber(server.net_in_speed),
      net_out: toNumber(server.net_out_speed),
      net_total_up: toNumber(server.net_tx),
      net_total_down: toNumber(server.net_rx),
      process: toNumber(server.processes),
      connections: toNumber(server.tcp_conn),
      connections_udp: toNumber(server.udp_conn),
      online: isServerOnline(server),
      uptime: uptimeSeconds(server),
    };
  }

  async getServersPayload(): Promise<{ nodes: NodeData[]; live: RpcNodeStatusMap; sysConfig: CfSysConfig }> {
    const payload = await this.request<{ servers?: CfServer[]; sysConfig?: CfSysConfig }>("/api/servers");
    const servers = Array.isArray(payload?.servers) ? payload.servers : [];
    const sysConfig = payload?.sysConfig || {};
    const nodes = servers.map((server) => this.mapNode(server, sysConfig));
    const live: RpcNodeStatusMap = {};
    servers.forEach((server) => {
      if (server.id) live[String(server.id)] = this.mapStatus(server);
    });
    return { nodes, live, sysConfig };
  }

  async getNodes(): Promise<NodeData[]> {
    return (await this.getServersPayload()).nodes;
  }

  async getLiveSnapshot(): Promise<RpcNodeStatusMap> {
    return (await this.getServersPayload()).live;
  }

  async getServer(id: string): Promise<{ node: NodeData; status: RpcNodeStatus } | null> {
    const server = await this.request<CfServer>(`/api/server?id=${encodeURIComponent(id)}`);
    if (!server?.id) return null;
    return { node: this.mapNode(server, server.sysConfig), status: this.mapStatus(server) };
  }

  async getNodeRecentStats(uuid: string): Promise<RpcNodeStatus[]> {
    return this.getRecentLoadHistory(uuid);
  }

  async getRecentLoadHistory(uuid: string): Promise<RpcNodeStatus[]> {
    const server = await this.getServer(uuid);
    return server ? [server.status] : [];
  }

  private mapHistoryRecord(row: CfServer, uuid: string): HistoryRecord {
    const [load] = parseLoadAverage(row.load_avg);
    const gpu = parseGpu(row.gpu_info);
    return {
      client: uuid,
      time: normalizeTimestamp(row.timestamp || row.last_updated),
      cpu: toFiniteOrNull(row.cpu),
      gpu: toFiniteOrNull(gpu.usage),
      ram: row.ram_used == null ? null : megabytesToBytes(row.ram_used),
      ram_total: row.ram_total == null ? null : megabytesToBytes(row.ram_total),
      swap: row.swap_used == null ? null : megabytesToBytes(row.swap_used),
      swap_total: row.swap_total == null ? null : megabytesToBytes(row.swap_total),
      load,
      temp: null,
      disk: row.disk_used == null ? null : megabytesToBytes(row.disk_used),
      disk_total: row.disk_total == null ? null : megabytesToBytes(row.disk_total),
      net_in: toFiniteOrNull(row.net_in_speed),
      net_out: toFiniteOrNull(row.net_out_speed),
      net_total_up: toFiniteOrNull(row.net_tx),
      net_total_down: toFiniteOrNull(row.net_rx),
      process: toFiniteOrNull(row.processes),
      connections: toFiniteOrNull(row.tcp_conn),
      connections_udp: toFiniteOrNull(row.udp_conn),
    };
  }

  async getLoadHistory(uuid: string, hours = 24, range?: HistoryQueryRange | null): Promise<LoadHistoryResponse | null> {
    const requestedHours = nearestHistoryHours(range ? rangeToHours(range) : hours);
    const rows = await this.request<CfServer[]>(`/api/history/all?id=${encodeURIComponent(uuid)}&hours=${requestedHours}`);
    if (!Array.isArray(rows)) return null;
    let records = rows.map((row) => this.mapHistoryRecord(row, uuid));
    if (range?.start && range?.end) {
      const start = new Date(range.start).getTime();
      const end = new Date(range.end).getTime();
      records = records.filter((record) => {
        const time = new Date(record.time).getTime();
        return time >= start && time <= end;
      });
    }
    return { count: records.length, records, from: range?.start, to: range?.end };
  }

  private pingTasksFromConfig(config: SiteConfig | null): PingTask[] {
    const labels: Record<string, string | undefined> = {
      ct: config?.custom_ct_name,
      cu: config?.custom_cu_name,
      cm: config?.custom_cm_name,
      bd: config?.custom_bd_name,
      node_1: config?.node_1_name,
      node_2: config?.node_2_name,
      node_3: config?.node_3_name,
      node_4: config?.node_4_name,
    };
    return PING_TASKS.map((task) => ({
      id: task.id,
      name: labels[task.key] || task.label,
      interval: 60,
    }));
  }

  async getPingHistory(uuid: string, hours = 24, range?: HistoryQueryRange | null): Promise<PingHistoryResponse | null> {
    const [rows, config] = await Promise.all([
      this.request<CfServer[]>(`/api/history/all?id=${encodeURIComponent(uuid)}&hours=${nearestHistoryHours(range ? rangeToHours(range) : hours)}`),
      this.getConfig(),
    ]);
    if (!Array.isArray(rows)) return null;
    const tasks = this.pingTasksFromConfig(config);
    const records: PingHistoryRecord[] = [];
    rows.forEach((row) => {
      const time = normalizeTimestamp(row.timestamp || row.last_updated);
      const timestamp = new Date(time).getTime();
      if (range?.start && timestamp < new Date(range.start).getTime()) return;
      if (range?.end && timestamp > new Date(range.end).getTime()) return;
      PING_TASKS.forEach((task) => {
        const value = toFiniteOrNull(row[`ping_${task.key}`]);
        const loss = toFiniteOrNull(row[`loss_${task.key}`]);
        if (value === null && loss === null) return;
        records.push({
          task_id: task.id,
          time,
          value: loss !== null && loss >= 100 ? null : value,
          ...(loss !== null ? { loss_ratio: Math.min(1, Math.max(0, loss / 100)) } : {}),
        });
      });
    });
    return { count: records.length, records, tasks, from: range?.start, to: range?.end };
  }

  async getPingTasks(): Promise<PingTaskFull[]> {
    const config = await this.getConfig();
    return this.pingTasksFromConfig(config).map((task) => ({
      id: task.id,
      weight: task.id,
      name: task.name,
      clients: [],
      type: "icmp",
      target: task.name,
      interval: task.interval,
    }));
  }

  async getPublicSettings(): Promise<PublicInfo | null> {
    const config = await this.getConfig();
    if (!config) return null;
    if (
      (config.default_language === "zh" || config.default_language === "en") &&
      localStorage.getItem("cfsm_language_applied") !== config.default_language
    ) {
      localStorage.setItem("language", config.default_language === "zh" ? "zh-CN" : "en-US");
      localStorage.setItem("cfsm_language_applied", config.default_language);
    }
    const themeSettings = {
      ...(config.theme_options && typeof config.theme_options === "object" ? config.theme_options : {}),
    } as Record<string, unknown>;
    if (!themeSettings.selectedDefaultAppearance && config.preferred_theme) {
      themeSettings.selectedDefaultAppearance = config.preferred_theme === "auto" ? "system" : config.preferred_theme;
    }
    if (!themeSettings.titleText && config.site_title) themeSettings.titleText = config.site_title;
    return {
      custom_body: "",
      custom_head: "",
      description: "",
      disable_password_login: false,
      oauth_enable: false,
      oauth_provider: null,
      load_metric_retention_days: 7,
      ping_metric_retention_days: 7,
      ping_record_preserve_time: 168,
      private_site: !isEnabled(config.is_public),
      record_enabled: true,
      record_preserve_time: 168,
      sitename: String(config.site_title || ""),
      theme: "cfsm",
      theme_settings: themeSettings,
    };
  }

  async getVersion(): Promise<{ version: string; hash: string }> {
    const config = await this.getConfig();
    return { version: String(config?.version || "unknown"), hash: "" };
  }

  async getUserInfo(): Promise<Me | null> {
    const config = await this.getConfig();
    if (!config) return null;
    return {
      logged_in: isEnabled(config.authorization),
      username: isEnabled(config.authorization) ? "admin" : "",
    };
  }

  async checkSiteStatus(): Promise<{ status: "public" | "authenticated" | "private-authenticated" | "private-unauthenticated"; publicInfo: PublicInfo | null }> {
    const [publicInfo, me] = await Promise.all([this.getPublicSettings(), this.getUserInfo()]);
    const loggedIn = me?.logged_in === true;
    if (!publicInfo) return { status: "private-unauthenticated", publicInfo: null };
    if (publicInfo.private_site) {
      return { status: loggedIn ? "private-authenticated" : "private-unauthenticated", publicInfo };
    }
    return { status: loggedIn ? "authenticated" : "public", publicInfo };
  }

  async saveThemeSettings(_theme: string, settings: Partial<any>): Promise<ApiResponse<any>> {
    const response = await fetch(`${getApiBase()}/api/theme_options`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ theme_options: settings }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return { status: "error", message: data?.error || "saveThemeOptionsFailed", data: null };
    }
    return { status: "success", message: "", data };
  }
}

export const apiService = new ApiService();

export class WebSocketService {
  private sockets: WebSocket[] = [];
  private listeners = new Set<(data: RpcNodeStatusMap) => void>();
  private snapshot: RpcNodeStatusMap = {};
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyDisconnected = false;
  private reconnectAttempts = 0;
  private visibilityBound = false;
  public useRpc = false;
  public onTimeout?: () => void;

  enableRpc() {
    this.useRpc = false;
  }

  disableRpcAndFallback() {
    this.useRpc = false;
  }

  connect() {
    if (this.sockets.some((socket) => socket.readyState < 2)) return;
    this.manuallyDisconnected = false;
    if (typeof document !== "undefined" && !this.visibilityBound) {
      this.visibilityBound = true;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) this.disconnect(false);
        else if (!this.manuallyDisconnected) this.connect();
      });
    }
    void this.open();
  }

  private async open() {
    const payload = await apiService.getServersPayload().catch(() => null);
    if (this.manuallyDisconnected) return;
    if (payload) {
      this.snapshot = { ...this.snapshot, ...payload.live };
      this.emit();
    }

    const ids = Object.keys(this.snapshot);
    const bases = this.apiBases();
    this.sockets = bases.map((base) => this.openSocket(base, ids));
    const config = await apiService.getConfig().catch(() => null);
    this.armLifetime(Number(config?.frontend_ws_timeout_minutes || 0));
  }

  private apiBases(): string[] {
    const content = typeof document === "undefined"
      ? ""
      : document.querySelector('meta[name="apiBase"]')?.getAttribute("content") || "";
    const configured = content.split(",").map((item) => item.trim()).filter(Boolean);
    return configured.length > 0 ? configured : [window.location.origin];
  }

  private openSocket(base: string, ids: string[]): WebSocket {
    const httpBase = new URL(base, window.location.origin);
    const url = new URL("/api/ws", httpBase);
    url.protocol = httpBase.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("subscribe", "all");
    if (url.host !== window.location.host) {
      const token = localStorage.getItem("jwt_token");
      if (token) url.searchParams.set("token", token);
    }
    const socket = new WebSocket(url.toString());
    socket.onopen = () => {
      this.reconnectAttempts = 0;
      socket.send(JSON.stringify({ type: "subscribe", scope: "all", ids }));
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = () => {
      this.sockets = this.sockets.filter((item) => item !== socket);
      if (!this.manuallyDisconnected && this.sockets.length === 0) this.scheduleReconnect();
    };
    return socket;
  }

  private handleMessage(raw: string) {
    let message: any;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message?.type !== "batchUpdate" || !Array.isArray(message.updates)) return;
    message.updates.forEach((update: any) => {
      const current = this.snapshot[update.serverId];
      if (!current) return;
      const samples = Array.isArray(update.samples) ? update.samples : [];
      samples.forEach((sample: any) => {
        const data = sample?.data || sample?.payload || sample?.metrics || {};
        const mapped = apiService["mapStatus"]({ ...current, ...data, id: update.serverId, last_updated: sample?.ts || message.ts });
        this.snapshot[update.serverId] = { ...current, ...mapped, online: true };
      });
    });
    this.emit();
  }

  private emit() {
    const data = { ...this.snapshot };
    this.listeners.forEach((listener) => listener(data));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.reconnectAttempts >= 5) return;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.open();
    }, 5000);
  }

  private armLifetime(minutes: number) {
    if (this.lifetimeTimer) clearTimeout(this.lifetimeTimer);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    this.lifetimeTimer = setTimeout(() => {
      this.disconnect(false);
      this.onTimeout?.();
    }, minutes * 60 * 1000);
  }

  resumeAfterTimeout() {
    this.reconnectAttempts = 0;
    this.connect();
  }

  subscribe(listener: (data: RpcNodeStatusMap) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect(manual = true) {
    this.manuallyDisconnected = manual;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.lifetimeTimer) clearTimeout(this.lifetimeTimer);
    this.reconnectTimer = null;
    this.lifetimeTimer = null;
    this.sockets.forEach((socket) => socket.close());
    this.sockets = [];
  }
}

let wsServiceInstance: WebSocketService | null = null;

export function getWsService(): WebSocketService {
  if (!wsServiceInstance) wsServiceInstance = new WebSocketService();
  return wsServiceInstance;
}
