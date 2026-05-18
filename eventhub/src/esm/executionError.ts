export interface ErrorMeta {
  event: string;
  handler: string;
  error: string;
  timestamp: string;
  environment: {
    platform: string;
    deviceModel: string;
    osVersion: string;
    userAgent: string;
  };
}

type UniApp = {
  getSystemInfoSync?: () => Record<string, unknown>;
};

// 统一错误处理管道
export function handleExecutionError(
  error: Error,
  event: string,
  handler: (...args: unknown[]) => unknown
): ErrorMeta {
  // 获取跨平台系统信息（兼容非UniApp环境）
  const uni = (globalThis as { uni?: UniApp }).uni;
  const systemInfo = uni?.getSystemInfoSync?.() ?? {};
  const platform = (systemInfo.platform as string)?.toLowerCase() || 'unknown';

  return {
    event,
    handler: handler.toString(),
    error: error.stack || error.toString(),
    timestamp: new Date().toISOString(),
    environment: {
      platform: mapPlatform(platform),
      deviceModel: (systemInfo.model as string) || 'Unknown',
      osVersion: (systemInfo.system as string) || 'Unknown',
      userAgent: typeof navigator !== 'undefined'
        ? navigator.userAgent
        : `UniApp/${systemInfo.platform || 'unknown'} v${systemInfo.version || ''}`
    }
  };
}

function mapPlatform(rawPlatform: string): string {
  const platformMap: Record<string, string> = {
    'ios': 'iOS',
    'android': 'Android',
    'windows': 'Windows',
    'mac': 'MacOS',
    'devtools': 'Browser',
    'mp-weixin': 'WeChatMP'
  };
  return platformMap[rawPlatform] || rawPlatform;
}

export function deBug(msg: string, eventType?: string, _handler?: unknown): never {
  const log = `${msg}::eventType:${eventType}::Date:${new Date().toISOString()}`;
  throw new Error(log);
}
