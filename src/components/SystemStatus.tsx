import type { BuildStatus } from '../lib/status';

// Fixed locale and zone so the server-rendered and hydrated text match.
const formatter = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
function When({ iso }: { iso: string }) {
  return <time dateTime={iso}>{formatter.format(new Date(iso))} UTC</time>;
}

const banners = {
  healthy: { className: 'status-good', label: '✓ All checks passed' },
  preview: { className: 'status-preview', label: '◐ Preview build' },
  attention: { className: 'status-bad', label: '! Something needs attention' },
} as const;

export default function SystemStatus({ status }: { status: BuildStatus }) {
  const banner = banners[status.level];
  const { content, tests } = status;
  const fromCms = content.source === 'contentstack';
  return (
    <>
      <div className={`status-banner ${banner.className}`}>
        <strong>{banner.label}</strong>
        <span>
          Built <When iso={status.builtAt} />. This page updates with every deploy.
        </span>
      </div>
      {!fromCms && (
        <p className="fine-print status-note">
          This build uses the seed snapshot that ships with the code. Contentstack is not connected yet.
        </p>
      )}
      {!tests && (
        <p className="fine-print status-note">Unit tests were not run for this build.</p>
      )}

      <div className="status-grid">
        <section className="panel status-panel" aria-labelledby="status-content">
          <h2 id="status-content">Content</h2>
          <ul className="status-list">
            <li>
              <span>Source</span>
              <span className={`status-pill ${fromCms ? 'status-pass' : ''}`}>
                {fromCms ? '✓ Contentstack' : 'Seed snapshot'}
              </span>
            </li>
            <li>
              <span>Last pulled from the CMS</span>
              <span>{content.syncedAt ? <When iso={content.syncedAt} /> : 'Never'}</span>
            </li>
            <li>
              <span>Species published</span>
              <span>{content.species}</span>
            </li>
            <li>
              <span>Field notes published</span>
              <span>{content.posts}</span>
            </li>
          </ul>
        </section>

        <section className="panel status-panel" aria-labelledby="status-checks">
          <h2 id="status-checks">Checks</h2>
          <table className="status-table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Unit tests</th>
                <td className={tests?.failed ? 'status-fail-text' : ''}>
                  {tests ? `${tests.passed} passed, ${tests.failed} failed` : 'Not run'}
                </td>
              </tr>
              <tr>
                <th scope="row">Content validation</th>
                <td>Required</td>
              </tr>
              <tr>
                <th scope="row">Type check</th>
                <td>Required</td>
              </tr>
              <tr>
                <th scope="row">Release security scan</th>
                <td>Required</td>
              </tr>
            </tbody>
          </table>
          <p className="fine-print">
            A deploy stops before upload if any required check fails, so the live site has passed all of them.
          </p>
        </section>

        <section className="panel status-panel status-wide" aria-labelledby="status-deploy">
          <h2 id="status-deploy">This deployment</h2>
          <ul className="status-list">
            <li>
              <span>App version</span>
              <span>{status.version ?? 'Unknown'}</span>
            </li>
            {status.trigger && (
              <li>
                <span>Started by</span>
                <span>{status.trigger === 'code-push' ? 'A code change' : 'A CMS publish or a manual run'}</span>
              </li>
            )}
            <li>
              <span>Built</span>
              <span>
                <When iso={status.builtAt} />
              </span>
            </li>
          </ul>
        </section>
      </div>
      <p className="fine-print status-note">
        Details are kept private on purpose. A failed deploy never replaces the live site, so failures appear only in the
        repository’s Actions history.
      </p>
    </>
  );
}
