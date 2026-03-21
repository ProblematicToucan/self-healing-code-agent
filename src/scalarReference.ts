/**
 * Serves Scalar API Reference UI via the official CDN (@scalar/api-reference),
 * matching the HTML shape produced by @scalar/core's getHtmlDocument.
 * (The Express middleware package is ESM-only; this project emits CommonJS.)
 */
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.49.1';

export type ScalarPageOptions = {
  /** OpenAPI document URL (same origin), e.g. `/openapi.json` */
  specUrl: string;
  pageTitle?: string;
  theme?: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function scalarReferenceHtml(options: ScalarPageOptions): string {
  const pageTitle = options.pageTitle ?? 'API Reference';
  const configuration: Record<string, unknown> = {
    url: options.specUrl,
  };
  if (options.theme) {
    configuration.theme = options.theme;
  }
  const configJson = JSON.stringify(configuration, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `      ${line}`))
    .join('\n');

  return `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(pageTitle)}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR_CDN}"></script>
    <script type="text/javascript">
      Scalar.createApiReference('#app', ${configJson})
    </script>
  </body>
</html>`;
}
