export class PollCanceledError extends Error {
  name = 'PollCanceledError';
  constructor() {
    super('[@nimble-api/api-extend] Poll canceled');
  }
}

export class PollTimeoutError extends Error {
  name = 'PollTimeoutError';
  attempts: number;
  constructor(attempts: number, interval: number) {
    super(`[@nimble-api/api-extend] Poll timed out after ${attempts} attempts (${attempts * interval}ms)`);
    this.attempts = attempts;
  }
}

export class PollFailedError<T> extends Error {
  name = 'PollFailedError';
  data: T;
  constructor(data: T) {
    super(`[@nimble-api/api-extend] Poll stopped by stopIf condition`);
    this.data = data;
  }
}
