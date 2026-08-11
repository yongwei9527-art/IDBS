const { AppError } = require('../../../lib/app-error');

const VALIDATED_AUTH_PRINCIPAL = Symbol('validated-auth-principal');
const AUTH_PRINCIPAL_USER = Symbol('auth-principal-user');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unauthorized() {
  return new AppError('\u672a\u767b\u5f55\u6216\u767b\u5f55\u5df2\u8fc7\u671f\u3002', { status: 401, code: 1001 });
}

function passwordResetRequired() {
  return new AppError('\u5bc6\u7801\u5df2\u7531\u7ba1\u7406\u5458\u91cd\u7f6e\uff0c\u8bf7\u5148\u8bbe\u7f6e\u65b0\u5bc6\u7801\u3002', { status: 403, code: 1005 });
}

function normalizeAuthzVersion(value) {
  const version = Number(value);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
}

function isValidatedAuthPrincipal(value) {
  return Boolean(value && typeof value === 'object' && value[VALIDATED_AUTH_PRINCIPAL] === true);
}

function getValidatedPrincipalUser(value) {
  return isValidatedAuthPrincipal(value) ? value[AUTH_PRINCIPAL_USER] || null : null;
}

function markValidatedPrincipal(principal, user) {
  Object.defineProperties(principal, {
    [VALIDATED_AUTH_PRINCIPAL]: { value: true },
    [AUTH_PRINCIPAL_USER]: { value: user }
  });
  return principal;
}

function createAuthPrincipalService(context = {}) {
  const { effectiveRolePermissions, queryOne } = context;

  if (typeof queryOne !== 'function' || typeof effectiveRolePermissions !== 'function') {
    throw new TypeError('Auth principal service requires queryOne and effectiveRolePermissions.');
  }

  async function loadCurrentUser(subject) {
    const userId = String(subject || '').trim();
    if (!UUID_PATTERN.test(userId)) throw unauthorized();
    const user = await queryOne(`
      select
        u.*,
        ar.role_key as admin_role_key,
        ar.permissions as admin_permissions
      from users u
      left join admin_roles ar on ar.user_id = u.id
      where u.id = $1 and u.deleted_at is null
      limit 1
    `, [userId]);
    if (!user || user.status !== 'active' || user.is_banned === true) throw unauthorized();
    return user;
  }

  function principalForUser(user) {
    const userRole = String(user.role || 'user').trim() || 'user';
    const hasAdminRole = Boolean(user.admin_role_key);
    const assignedRoleKey = String(user.admin_role_key || '').trim();
    const assignedPermissions = hasAdminRole
      ? effectiveRolePermissions({ role_key: assignedRoleKey, permissions: user.admin_permissions })
      : [];
    // Older databases sometimes represented the highest administrator only in
    // admin_roles (or with the historical wildcard permission). Preserve that
    // account while still deriving authority exclusively from current DB rows.
    const isHighestAdmin = userRole === 'super_admin'
      || (hasAdminRole && (assignedRoleKey === 'super_admin' || assignedPermissions.includes('*')));
    let role = userRole;
    let scope = 'user';
    let adminRoleKey;
    let permissions = [];

    if (isHighestAdmin) {
      role = 'super_admin';
      scope = 'admin';
      adminRoleKey = 'super_admin';
      permissions = ['*'];
    } else if (hasAdminRole || userRole === 'admin') {
      role = 'admin';
      scope = 'admin';
      adminRoleKey = assignedRoleKey || 'admin';
      permissions = assignedPermissions;
    }

    const authzVersion = normalizeAuthzVersion(user.authz_version);
    if (!authzVersion) throw unauthorized();

    return markValidatedPrincipal({
      sub: String(user.id),
      user_id: String(user.id),
      id: String(user.id),
      scope,
      role,
      admin_role_key: adminRoleKey,
      perms: [...permissions],
      permissions: [...permissions],
      password_reset_required: Boolean(user.password_reset_required),
      authz_version: authzVersion,
      name: user.name || ''
    }, user);
  }

  function enforcePasswordState(principal, options = {}) {
    if (!options.allowPasswordReset && principal.password_reset_required) {
      throw passwordResetRequired();
    }
    return principal;
  }

  async function resolveCurrentAuthPrincipal(auth = {}, options = {}) {
    if (isValidatedAuthPrincipal(auth)) return enforcePasswordState(auth, options);
    const user = await loadCurrentUser(auth?.sub || auth?.user_id || auth?.id);
    return enforcePasswordState(principalForUser(user), options);
  }

  async function validateAccessTokenAuth(auth = {}, options = {}) {
    if (isValidatedAuthPrincipal(auth)) return enforcePasswordState(auth, options);
    const tokenVersion = normalizeAuthzVersion(auth?.authz_version);
    if (!tokenVersion) throw unauthorized();
    const principal = await resolveCurrentAuthPrincipal(auth, { allowPasswordReset: true });
    if (principal.authz_version !== tokenVersion) throw unauthorized();
    return enforcePasswordState(principal, options);
  }

  return { resolveCurrentAuthPrincipal, validateAccessTokenAuth };
}

module.exports = {
  createAuthPrincipalService,
  getValidatedPrincipalUser,
  isValidatedAuthPrincipal,
  normalizeAuthzVersion
};
