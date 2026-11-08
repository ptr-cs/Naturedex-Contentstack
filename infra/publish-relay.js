'use strict';
// Contentstack webhook -> GitHub workflow_dispatch. Contentstack cannot send
// GitHub's request body, so this relay checks the webhook's Basic Auth and
// starts the deploy workflow. It forwards nothing from the webhook payload.
const { timingSafeEqual } = require('node:crypto');

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

exports.handler = async (event) => {
  const env = process.env;
  const method = event && event.requestContext && event.requestContext.http && event.requestContext.http.method;
  if (method !== 'POST') return { statusCode: 405 };
  const header = (event.headers && event.headers.authorization) || '';
  const expected = 'Basic ' + Buffer.from(env.WEBHOOK_USER + ':' + env.WEBHOOK_PASSWORD).toString('base64');
  if (!same(header, expected)) return { statusCode: 401 };
  const url = 'https://api.github.com/repos/' + env.GITHUB_REPOSITORY + '/actions/workflows/' + env.GITHUB_WORKFLOW + '/dispatches';
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'naturedex-publish-relay',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: env.GITHUB_REF }),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.error('GitHub dispatch request failed');
    return { statusCode: 502 };
  }
  if (!response.ok) {
    console.error('GitHub dispatch returned HTTP ' + response.status);
    return { statusCode: 502 };
  }
  return { statusCode: 204 };
};
