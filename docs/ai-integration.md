# Optional Contentstack integration for Codex and ChatGPT

This integration is useful for inspecting models and assisting authoring. It is **not required** to run Naturedex or deploy its static frontend, and nothing has been installed or connected by this project.

Contentstack documents two options:

- [MCP Profile Hub](https://www.contentstack.com/docs/developers/mcp-profile-hub-connect-a-client-to-profile-hub): a remote MCP endpoint with Contentstack OAuth, documented for both Codex and ChatGPT. Create and publish a profile in your Contentstack organization, select the stack and tools, then use that profile's generated client instructions. ChatGPT availability depends on custom connector support for your account/workspace.
- [Contentstack MCP Server](https://www.contentstack.com/docs/developers/contentstack-mcp-server): a locally run MCP server for compatible clients, including content management and read-only delivery tools. The official package is `@contentstack/mcp`; use the documented authentication and configuration instructions.

For Naturedex, start with stack/model inspection and entry lookup. If you later enable create/edit/publish tools, those actions change your real CMS. Authorizing a CMS integration does not deploy the website to AWS; the website still needs content sync, build, and release.

MCP Profile Hub uses OAuth rather than copying bearer tokens into the connector URL. Keep project delivery/import tokens in the ignored `.env` only. Never put management tokens in React props, public files, or AWS S3 objects.

Sources verified November 6, 2026. The plugin catalog search returned no Contentstack listing in this session; that does not establish that the full directory has none.
