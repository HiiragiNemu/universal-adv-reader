/** This checkout has local native revisions, not the Reader production backend.
 * Deliberately independent of Cloudflare bindings, browser tokens and env flags.
 * Enabling a generic service requires its own implementation and destination. */
export const GENERIC_BACKEND_STATUS = {
  schema: 'generic-reader-backend/v1',
  backend: 'unconfigured',
  submissions_enabled: false,
  turnstile_site_key: '',
  target_branch: null,
  source_revision: null,
  github_admin_auth: false,
  shared_admin_auth: false,
  server_pr_creation: false,
  turnstile_test_mode: false,
  local: {
    patch_schema: 'native-reader-translation-patch/v1',
    revision_registry: '/native-reader-revisions.json',
    native_review_mode: 'loopback-local',
    native_review_endpoint: '/api/native-reviews',
    native_review_workflow: ['submit','approve-or-reject','stage-approved','install-explicit','rollback-explicit'],
    text_schema: 'native-reader-text/v1',
    workflow: ['edit', 'export-patch', 'stage', 'install-local', 'rollback-local'],
  },
  missing: [
    { id: 'GEN11-REMOTE', label: '通用工程专用远端仓库、目标分支与逐次发布授权' },
    { id: 'GEN11-AUTH', label: '独立的投稿身份验证、口令及反滥用服务' },
    { id: 'GEN11-STORE', label: '远端原生补丁投稿、审核与回执服务（本地队列已接入）' },
    { id: 'GEN11-APPLY', label: '远端审核发布接口（本地已接入明确批准后的生成、安装与回滚）' },
  ],
} as const;

export function genericBackendResponse(configuration = false): Response {
  return Response.json({
    ...GENERIC_BACKEND_STATUS,
    ...(!configuration ? {
      code: 'GENERIC_BACKEND_NOT_CONFIGURED',
      error: '通用投稿与审核后端尚未配置；本地原生补丁导出和版本化修订仍可使用。',
    } : {}),
  }, { status: configuration ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
