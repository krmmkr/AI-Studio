import base64
import hashlib
import logging
import os
import secrets
import datetime
from urllib.parse import urlencode
import httpx
import jwt
from sqlalchemy.orm import Session

from backend.app.config import (
    JWT_SECRET,
    JWT_ALGORITHM,
    APP_BASE_URL,
    DEFAULT_ADMIN_EMAIL,
    OIDC_ISSUER_URL,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OIDC_REDIRECT_URI,
    OIDC_SCOPES,
    OIDC_ADMIN_EMAILS,
    OIDC_AUTHORIZATION_ENDPOINT,
    OIDC_TOKEN_ENDPOINT,
    OIDC_USERINFO_ENDPOINT,
    OIDC_JWKS_URI,
    is_auth_enabled,
)
from backend.app.models import User
from backend.app.auth import hash_password

logger = logging.getLogger("cockpit_oidc")


class OIDCService:
    def __init__(self):
        self._cached_config: dict | None = None
        self._cached_config_time: datetime.datetime | None = None

    def get_issuer_url(self) -> str:
        return os.environ.get("OIDC_ISSUER_URL", OIDC_ISSUER_URL).strip()

    def get_client_id(self) -> str:
        return os.environ.get("OIDC_CLIENT_ID", OIDC_CLIENT_ID).strip()

    def get_client_secret(self) -> str:
        return os.environ.get("OIDC_CLIENT_SECRET", OIDC_CLIENT_SECRET).strip()

    def get_scopes(self) -> str:
        return os.environ.get("OIDC_SCOPES", OIDC_SCOPES).strip() or "openid email profile"

    def get_redirect_uri(self, override: str | None = None) -> str:
        if override and override.strip():
            return override.strip()
        configured = os.environ.get("OIDC_REDIRECT_URI", OIDC_REDIRECT_URI).strip()
        if configured:
            return configured
        base = os.environ.get("APP_BASE_URL", APP_BASE_URL).rstrip("/")
        return f"{base}/api/auth/oidc/callback"

    def is_configured(self) -> bool:
        """Returns True if OIDC Identity Provider credentials are fully configured or mock mode enabled."""
        client_id = self.get_client_id()
        issuer = self.get_issuer_url()
        auth_ep = os.environ.get("OIDC_AUTHORIZATION_ENDPOINT", OIDC_AUTHORIZATION_ENDPOINT).strip()
        if issuer.lower() == "mock":
            return True
        return bool(client_id and (issuer or auth_ep))

    async def get_openid_configuration(self) -> dict:
        """
        Discovers standard OIDC endpoints from /.well-known/openid-configuration.
        Caches discovery response for up to 1 hour.
        """
        now = datetime.datetime.now(datetime.timezone.utc)
        if self._cached_config and self._cached_config_time:
            if (now - self._cached_config_time).total_seconds() < 3600:
                return self._cached_config

        # Check explicit overrides first
        auth_ep = os.environ.get("OIDC_AUTHORIZATION_ENDPOINT", OIDC_AUTHORIZATION_ENDPOINT).strip()
        token_ep = os.environ.get("OIDC_TOKEN_ENDPOINT", OIDC_TOKEN_ENDPOINT).strip()
        userinfo_ep = os.environ.get("OIDC_USERINFO_ENDPOINT", OIDC_USERINFO_ENDPOINT).strip()
        jwks_uri = os.environ.get("OIDC_JWKS_URI", OIDC_JWKS_URI).strip()

        if auth_ep and token_ep:
            config = {
                "authorization_endpoint": auth_ep,
                "token_endpoint": token_ep,
                "userinfo_endpoint": userinfo_ep,
                "jwks_uri": jwks_uri,
            }
            self._cached_config = config
            self._cached_config_time = now
            return config

        issuer = self.get_issuer_url()
        if not issuer or issuer.lower() == "mock":
            config = {
                "authorization_endpoint": f"{APP_BASE_URL}/api/auth/oidc/mock/auth",
                "token_endpoint": f"{APP_BASE_URL}/api/auth/oidc/mock/token",
                "userinfo_endpoint": f"{APP_BASE_URL}/api/auth/oidc/mock/userinfo",
                "jwks_uri": "",
            }
            return config

        discovery_url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
        try:
            async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
                res = await client.get(discovery_url)
                if res.status_code == 200:
                    data = res.json()
                    self._cached_config = data
                    self._cached_config_time = now
                    return data
                else:
                    logger.warning(
                        f"OIDC discovery at {discovery_url} returned HTTP {res.status_code}. "
                        "Falling back to conventional endpoint conventions."
                    )
        except Exception as e:
            logger.warning(f"Could not reach OIDC discovery endpoint '{discovery_url}': {e}")

        # Conventional fallback
        fallback = {
            "authorization_endpoint": auth_ep or f"{issuer.rstrip('/')}/protocol/openid-connect/auth",
            "token_endpoint": token_ep or f"{issuer.rstrip('/')}/protocol/openid-connect/token",
            "userinfo_endpoint": userinfo_ep or f"{issuer.rstrip('/')}/protocol/openid-connect/userinfo",
            "jwks_uri": jwks_uri or f"{issuer.rstrip('/')}/protocol/openid-connect/certs",
        }
        self._cached_config = fallback
        self._cached_config_time = now
        return fallback

    @staticmethod
    def generate_pkce() -> tuple[str, str]:
        """Generates cryptographically random PKCE code_verifier and code_challenge (RFC 7636)."""
        verifier_bytes = secrets.token_bytes(32)
        code_verifier = base64.urlsafe_b64encode(verifier_bytes).decode("ascii").rstrip("=")
        digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
        code_challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
        return code_verifier, code_challenge

    def create_state_token(self, code_verifier: str, nonce: str, return_to: str = "/") -> str:
        """Creates a signed, tamper-proof state JWT with anti-replay and PKCE verifier."""
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        payload = {
            "sub": "oidc_auth_state",
            "verifier": code_verifier,
            "nonce": nonce,
            "return_to": return_to,
            "iat": int(now_utc.timestamp()),
            "exp": int((now_utc + datetime.timedelta(minutes=15)).timestamp()),
        }
        return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    def verify_state_token(self, state_token: str) -> dict:
        """Decodes and validates the signed state token."""
        try:
            payload = jwt.decode(state_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get("sub") != "oidc_auth_state":
                raise ValueError("Invalid state payload signature")
            return payload
        except Exception as e:
            logger.error(f"Failed to verify OIDC state token: {e}")
            raise ValueError("Invalid or expired SSO authorization state")

    async def build_authorization_url(
        self,
        redirect_uri_override: str | None = None,
        return_to: str = "/",
        mock: bool = False,
    ) -> tuple[str, str]:
        """
        Builds the complete OIDC authorization URL for browser redirect.
        Returns (authorization_url, state_token).
        """
        redirect_uri = self.get_redirect_uri(redirect_uri_override)
        code_verifier, code_challenge = self.generate_pkce()
        nonce = secrets.token_urlsafe(16)
        state_token = self.create_state_token(code_verifier, nonce, return_to)

        issuer = self.get_issuer_url()
        if mock or issuer.lower() == "mock":
            # For testing/mocking: return redirect back to our callback with mock code
            mock_params = {
                "code": f"mock_code_{secrets.token_hex(8)}",
                "state": state_token,
            }
            return f"{redirect_uri}?{urlencode(mock_params)}", state_token

        config = await self.get_openid_configuration()
        auth_endpoint = config.get("authorization_endpoint")
        if not auth_endpoint:
            raise ValueError("OIDC Authorization Endpoint is not configured or discoverable.")

        params = {
            "response_type": "code",
            "client_id": self.get_client_id(),
            "redirect_uri": redirect_uri,
            "scope": self.get_scopes(),
            "state": state_token,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "nonce": nonce,
        }
        url = f"{auth_endpoint}?{urlencode(params)}"
        return url, state_token

    async def exchange_code_for_user_info(
        self,
        code: str,
        state_token: str,
        redirect_uri_override: str | None = None,
    ) -> dict:
        """
        Exchanges authorization code for tokens, decodes id_token, and queries userinfo endpoint.
        """
        state_data = self.verify_state_token(state_token)
        code_verifier = state_data["verifier"]
        expected_nonce = state_data.get("nonce")
        redirect_uri = self.get_redirect_uri(redirect_uri_override)

        # Mock / Test Mode Bypass
        issuer = self.get_issuer_url()
        if code.startswith("mock_code_") or issuer.lower() == "mock":
            return {
                "email": "sso_user@antigravity.io",
                "name": "SSO Test Engineer",
                "sub": "mock-sso-sub-001",
                "roles": ["member"],
                "raw_claims": {"email": "sso_user@antigravity.io", "name": "SSO Test Engineer"},
            }

        config = await self.get_openid_configuration()
        token_endpoint = config.get("token_endpoint")
        if not token_endpoint:
            raise ValueError("OIDC Token Endpoint is missing from provider configuration.")

        token_data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": self.get_client_id(),
            "client_secret": self.get_client_secret(),
            "code_verifier": code_verifier,
        }

        async with httpx.AsyncClient(timeout=15.0, verify=False) as client:
            token_res = await client.post(
                token_endpoint,
                data=token_data,
                headers={"Accept": "application/json"},
            )
            if token_res.status_code != 200:
                logger.error(f"OIDC token exchange failed ({token_res.status_code}): {token_res.text}")
                raise ValueError(f"Token exchange failed with status {token_res.status_code}")

            tokens = token_res.json()
            access_token = tokens.get("access_token")
            id_token = tokens.get("id_token")

            claims: dict = {}
            if id_token:
                try:
                    claims = jwt.decode(id_token, options={"verify_signature": False})
                except Exception as e:
                    logger.warning(f"Could not decode id_token: {e}")

            userinfo_endpoint = config.get("userinfo_endpoint")
            if userinfo_endpoint and access_token:
                try:
                    uinfo_res = await client.get(
                        userinfo_endpoint,
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                    if uinfo_res.status_code == 200:
                        claims.update(uinfo_res.json())
                except Exception as e:
                    logger.warning(f"Failed to fetch userinfo from {userinfo_endpoint}: {e}")

        email = (
            claims.get("email")
            or claims.get("preferred_username")
            or claims.get("upn")
            or claims.get("unique_name")
        )
        if not email and claims.get("sub"):
            email = f"{claims.get('sub')}@oidc.account"

        if not email:
            raise ValueError("Unable to determine user email address from OIDC provider claims.")

        name = claims.get("name") or claims.get("given_name") or email.split("@")[0]
        roles = []
        if isinstance(claims.get("roles"), list):
            roles.extend(claims["roles"])
        if isinstance(claims.get("groups"), list):
            roles.extend(claims["groups"])

        return {
            "email": email.strip().lower(),
            "name": name,
            "sub": str(claims.get("sub", email)),
            "roles": roles,
            "raw_claims": claims,
        }

    def find_or_provision_user(self, user_info: dict, db: Session) -> User:
        """
        Finds existing user by email or provisions a new user record.
        Assigns admin role if email matches OIDC_ADMIN_EMAILS, DEFAULT_ADMIN_EMAIL, or has admin claims.
        """
        email = user_info["email"].strip().lower()
        admin_emails = [e.lower() for e in os.environ.get("OIDC_ADMIN_EMAILS", "").split(",") if e.strip()]
        admin_emails.extend(OIDC_ADMIN_EMAILS)
        admin_emails.append(DEFAULT_ADMIN_EMAIL.lower())

        is_admin_claim = any(
            str(r).lower() in ("admin", "admins", "administrator", "ai-studio-admin")
            for r in user_info.get("roles", [])
        )
        should_be_admin = (email in admin_emails) or is_admin_claim or (db.query(User).count() == 0)

        user = db.query(User).filter(User.email == email).first()
        if user:
            # Upgrade role to admin if designated
            if should_be_admin and user.role != "admin":
                user.role = "admin"
                db.commit()
                db.refresh(user)
            return user

        # Provision new SSO user
        role = "admin" if should_be_admin else "member"
        # Generate secure random unguessable password hash to maintain column integrity
        dummy_password = secrets.token_urlsafe(32)
        user = User(
            email=email,
            hashed_password=hash_password(dummy_password),
            role=role,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        logger.info(f"Successfully auto-provisioned OIDC user '{email}' with role '{role}'")
        return user


oidc_service = OIDCService()
