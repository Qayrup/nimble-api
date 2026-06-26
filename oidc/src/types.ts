export interface OidcConfig {
  authority: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  silentRefreshUri?: string;
  scopes?: string[];
  onBeforeLogin?: () => void;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  idToken?: string;
  tokenType: string;
  scope?: string;
}

export interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  revocation_endpoint: string;
  end_session_endpoint?: string;
  scopes_supported?: string[];
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export interface TokenChangedEvent {
  token: TokenSet | null;
  source: 'login' | 'silent-refresh' | 'logout' | 'expired';
}
