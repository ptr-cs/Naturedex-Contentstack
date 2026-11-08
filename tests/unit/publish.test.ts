import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const template = JSON.parse(read('infra/publish.yaml'));
const resources = template.Resources;
const workflow = read('.github/workflows/deploy.yml');

const env = {
  WEBHOOK_USER: 'contentstack', WEBHOOK_PASSWORD: 'correct-horse-battery-staple-123',
  GITHUB_TOKEN: 'github_pat_test', GITHUB_REPOSITORY: 'owner/naturedex', GITHUB_WORKFLOW: 'deploy.yml', GITHUB_REF: 'main',
};
const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

/** Loads the exact inline Lambda source from the template with a controlled fetch. */
function relay(fetchImpl: (...args: unknown[]) => Promise<{ ok: boolean; status: number }>) {
  const module = { exports: {} as { handler: (event: unknown) => Promise<{ statusCode: number }> } };
  const nodeRequire = createRequire(import.meta.url);
  runInNewContext(resources.RelayFunction.Properties.Code.ZipFile, {
    module, exports: module.exports, Buffer, AbortSignal, console: { error: () => {} },
    process: { env }, fetch: fetchImpl,
    require: (id: string) => { if (id !== 'node:crypto') throw new Error(`unexpected require ${id}`); return nodeRequire(id); },
  });
  return module.exports.handler;
}
const post = (authorization?: string, body = '{"event":"publish"}') =>
  ({ requestContext: { http: { method: 'POST' } }, headers: authorization ? { authorization } : {}, body });

describe('Contentstack publish relay', () => {
  it('is generated from infra/publish-relay.js', () => {
    expect(resources.RelayFunction.Properties.Code.ZipFile).toBe(read('infra/publish-relay.js'));
  });

  it('rejects other methods and wrong or missing credentials without calling GitHub', async () => {
    const fetchImpl = vi.fn();
    const handler = relay(fetchImpl);
    expect(await handler({ requestContext: { http: { method: 'GET' } }, headers: {} })).toEqual({ statusCode: 405 });
    expect(await handler(post())).toEqual({ statusCode: 401 });
    expect(await handler(post(basic('contentstack', 'wrong')))).toEqual({ statusCode: 401 });
    expect(await handler(post(basic('someone', env.WEBHOOK_PASSWORD)))).toEqual({ statusCode: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('starts the deploy workflow on main and forwards nothing from the webhook', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const result = await relay(fetchImpl)(post(basic('contentstack', env.WEBHOOK_PASSWORD), '{"ref":"attacker-branch"}'));
    expect(result).toEqual({ statusCode: 204 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string; redirect: string }];
    expect(url).toBe('https://api.github.com/repos/owner/naturedex/actions/workflows/deploy.yml/dispatches');
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe('Bearer github_pat_test');
    expect(JSON.parse(init.body)).toEqual({ ref: 'main' });
  });

  it('reports GitHub failures as 502 so Contentstack records a failed delivery', async () => {
    const authorized = post(basic('contentstack', env.WEBHOOK_PASSWORD));
    expect(await relay(async () => ({ ok: false, status: 403 }))(authorized)).toEqual({ statusCode: 502 });
    expect(await relay(async () => { throw new Error('network'); })(authorized)).toEqual({ statusCode: 502 });
  });

  it('is public only through its function URL, with secrets never echoed', () => {
    expect(resources.RelayUrl.Properties.AuthType).toBe('NONE');
    expect(resources.RelayUrlPermission.Properties).toMatchObject({ Action: 'lambda:InvokeFunctionUrl', FunctionUrlAuthType: 'NONE' });
    expect(resources.RelayInvokePermission.Properties).toMatchObject({ Action: 'lambda:InvokeFunction', InvokedViaFunctionUrl: true });
    expect(template.Parameters.GitHubToken.NoEcho).toBe(true);
    expect(template.Parameters.WebhookPassword).toMatchObject({ NoEcho: true, MinLength: 24 });
    expect(resources.RelayLogGroup.Properties.RetentionInDays).toBeLessThanOrEqual(30);
  });
});

describe('GitHub deploy role', () => {
  const role = resources.DeployRole.Properties;
  it('trusts only the production environment of one repository', () => {
    const trust = role.AssumeRolePolicyDocument.Statement[0];
    expect(trust.Action).toBe('sts:AssumeRoleWithWebIdentity');
    expect(trust.Condition.StringEquals['token.actions.githubusercontent.com:aud']).toBe('sts.amazonaws.com');
    const subject = trust.Condition.StringEquals['token.actions.githubusercontent.com:sub']['Fn::Join'][1];
    expect(subject[0]).toBe('repo:');
    expect(subject[2]).toBe(':environment:production');
    expect(JSON.stringify(trust.Condition)).not.toMatch(/StringLike|\*/);
  });

  it('can upload and invalidate the site but not change infrastructure', () => {
    const statements = role.Policies.flatMap((policy: { PolicyDocument: { Statement: unknown[] } }) => policy.PolicyDocument.Statement) as { Action: string | string[]; Resource: unknown }[];
    const actions = statements.flatMap((statement) => [statement.Action].flat());
    expect(actions.sort()).toEqual(['cloudformation:DescribeStacks', 'cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation', 's3:DeleteObject', 's3:GetObject', 's3:ListBucket', 's3:PutObject']);
    for (const statement of statements) expect(statement.Resource).not.toBe('*');
  });

  it('reuses an existing account OIDC provider when given one', () => {
    expect(resources.GitHubOidcProvider.Condition).toBe('CreateOidcProvider');
    expect(role.AssumeRolePolicyDocument.Statement[0].Principal.Federated['Fn::If'][0]).toBe('CreateOidcProvider');
  });
});

describe('deploy workflow', () => {
  it('never runs for pull requests and keeps secrets in the production environment', () => {
    expect(workflow).not.toMatch(/pull_request/);
    expect(workflow).toMatch(/^\s+environment: production$/m);
    expect(workflow).toMatch(/id-token: write/);
    expect(workflow).toMatch(/cancel-in-progress: false/);
    expect(workflow).not.toMatch(/MANAGEMENT_TOKEN/);
  });

  it('pins every action to a commit SHA', () => {
    const uses = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action).toMatch(/@[0-9a-f]{40}$/);
  });

  it('uploads content only; infrastructure changes stay manual', () => {
    expect(workflow).toMatch(/npm run deploy:aws -- content/);
    expect(workflow).not.toMatch(/cloudformation deploy/);
  });
});
