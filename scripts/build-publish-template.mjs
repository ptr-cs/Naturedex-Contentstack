import { readFileSync, writeFileSync } from 'node:fs';
// Regenerates infra/publish.yaml (JSON-compatible YAML) from infra/publish-relay.js.
const relayPath = new URL('../infra/publish-relay.js', import.meta.url);
const outPath = new URL('../infra/publish.yaml', import.meta.url);
const code = readFileSync(relayPath, 'utf8');
if (code.length > 4096) throw new Error(`Relay is ${code.length} chars; inline ZipFile limit is 4096`);
const sub = (s) => ({ 'Fn::Sub': s });
const ref = (r) => ({ Ref: r });
const empty = (p) => ({ 'Fn::Equals': [ref(p), ''] });

const t = {
  AWSTemplateFormatVersion: '2010-09-09',
  Description: 'Naturedex publish-to-live: GitHub Actions deploy role (OIDC) and a Contentstack webhook relay that starts the deploy workflow.',
  Parameters: {
    Repository: { Type: 'String', AllowedPattern: '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', Description: 'GitHub repository as owner/name.' },
    OidcRepository: { Type: 'String', Default: '', Description: 'Repository as it appears in the OIDC subject, if different (e.g. owner@123/name@456). Blank uses Repository.' },
    ExistingOidcProviderArn: { Type: 'String', Default: '', Description: 'ARN of an existing token.actions.githubusercontent.com provider. An account may only have one; blank creates it.' },
    SiteStackName: { Type: 'String', Default: 'naturedex-contentstack' },
    BucketName: { Type: 'String', Description: 'BucketName output of the site stack.' },
    DistributionId: { Type: 'String', AllowedPattern: '^[A-Z0-9]+$', Description: 'DistributionId output of the site stack.' },
    GitHubToken: { Type: 'String', NoEcho: true, MinLength: 20, Description: 'Fine-grained token for this repository only, with Actions: read and write.' },
    WebhookPassword: { Type: 'String', NoEcho: true, MinLength: 24, Description: 'Basic Auth password Contentstack sends with the webhook.' },
    WorkflowFile: { Type: 'String', Default: 'deploy.yml' },
    Branch: { Type: 'String', Default: 'main' },
  },
  Conditions: {
    CreateOidcProvider: empty('ExistingOidcProviderArn'),
    UseRepositoryForOidc: empty('OidcRepository'),
  },
  Resources: {
    GitHubOidcProvider: {
      Type: 'AWS::IAM::OIDCProvider',
      Condition: 'CreateOidcProvider',
      Properties: { Url: 'https://token.actions.githubusercontent.com', ClientIdList: ['sts.amazonaws.com'] },
    },
    DeployRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        Description: 'GitHub Actions uploads the Naturedex static site. Content only; infrastructure changes stay manual.',
        MaxSessionDuration: 3600,
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [{
            Effect: 'Allow',
            Principal: { Federated: { 'Fn::If': ['CreateOidcProvider', ref('GitHubOidcProvider'), ref('ExistingOidcProviderArn')] } },
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                // Only jobs in the "production" GitHub environment, which is limited to main.
                'token.actions.githubusercontent.com:sub': {
                  'Fn::Join': ['', ['repo:', { 'Fn::If': ['UseRepositoryForOidc', ref('Repository'), ref('OidcRepository')] }, ':environment:production']],
                },
              },
            },
          }],
        },
        Policies: [{
          PolicyName: 'upload-site',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              { Sid: 'ReadSiteOutputs', Effect: 'Allow', Action: 'cloudformation:DescribeStacks', Resource: sub('arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${SiteStackName}/*') },
              { Sid: 'ListBucket', Effect: 'Allow', Action: 's3:ListBucket', Resource: sub('arn:${AWS::Partition}:s3:::${BucketName}') },
              { Sid: 'WriteObjects', Effect: 'Allow', Action: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'], Resource: sub('arn:${AWS::Partition}:s3:::${BucketName}/*') },
              { Sid: 'Invalidate', Effect: 'Allow', Action: ['cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation'], Resource: sub('arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${DistributionId}') },
            ],
          },
        }],
      },
    },
    RelayLogGroup: {
      Type: 'AWS::Logs::LogGroup',
      DeletionPolicy: 'Delete',
      Properties: { RetentionInDays: 14 },
    },
    RelayRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        },
        Policies: [{
          PolicyName: 'write-logs',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: { 'Fn::GetAtt': ['RelayLogGroup', 'Arn'] } }],
          },
        }],
      },
    },
    RelayFunction: {
      Type: 'AWS::Lambda::Function',
      Properties: {
        Description: 'Contentstack publish webhook -> GitHub deploy workflow.',
        Runtime: 'nodejs24.x',
        Architectures: ['arm64'],
        Handler: 'index.handler',
        MemorySize: 128,
        Timeout: 10,
        Role: { 'Fn::GetAtt': ['RelayRole', 'Arn'] },
        LoggingConfig: { LogGroup: ref('RelayLogGroup') },
        Environment: {
          Variables: {
            WEBHOOK_USER: 'contentstack',
            WEBHOOK_PASSWORD: ref('WebhookPassword'),
            GITHUB_TOKEN: ref('GitHubToken'),
            GITHUB_REPOSITORY: ref('Repository'),
            GITHUB_WORKFLOW: ref('WorkflowFile'),
            GITHUB_REF: ref('Branch'),
          },
        },
        Code: { ZipFile: code },
      },
    },
    RelayUrl: {
      Type: 'AWS::Lambda::Url',
      Properties: { AuthType: 'NONE', TargetFunctionArn: { 'Fn::GetAtt': ['RelayFunction', 'Arn'] } },
    },
    RelayUrlPermission: {
      Type: 'AWS::Lambda::Permission',
      Properties: { Action: 'lambda:InvokeFunctionUrl', FunctionName: ref('RelayFunction'), Principal: '*', FunctionUrlAuthType: 'NONE' },
    },
    RelayInvokePermission: {
      Type: 'AWS::Lambda::Permission',
      Properties: { Action: 'lambda:InvokeFunction', FunctionName: ref('RelayFunction'), Principal: '*', InvokedViaFunctionUrl: true },
    },
  },
  Outputs: {
    DeployRoleArn: { Value: { 'Fn::GetAtt': ['DeployRole', 'Arn'] }, Description: 'Set as the GitHub variable AWS_DEPLOY_ROLE_ARN.' },
    WebhookUrl: { Value: { 'Fn::GetAtt': ['RelayUrl', 'FunctionUrl'] }, Description: 'Contentstack webhook URL (Basic Auth user: contentstack).' },
  },
};
writeFileSync(outPath, JSON.stringify(t, null, 2) + '\n');
console.log(`Wrote infra/publish.yaml (relay ${code.length} of 4096 inline characters).`);
