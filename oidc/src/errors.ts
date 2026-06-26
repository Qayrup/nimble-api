export class OidcError extends Error {
  constructor(message: string) {
    super(`[@nimble-api/oidc] ${message}`);
    this.name = 'OidcError';
  }
}

export class OidcStateError extends OidcError {
  constructor() {
    super('Invalid state — possible CSRF attack');
    this.name = 'OidcStateError';
  }
}

export class OidcTokenError extends OidcError {
  code: string | undefined;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'OidcTokenError';
    this.code = code;
  }
}

export class OidcUnavailableError extends OidcError {
  constructor(feature: string) {
    super(`${feature} is not available in this environment`);
    this.name = 'OidcUnavailableError';
  }
}
