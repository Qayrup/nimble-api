export function deBug(msg: string, eventType?: string, _handler?: unknown): never {
  const log = `${msg}::eventType:${eventType}::Date:${new Date().toISOString()}`;
  throw new Error(log);
}
